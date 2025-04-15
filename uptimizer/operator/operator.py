import kopf
import kubernetes
import yaml
import os
import json
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Determine if running inside a cluster
if os.getenv('KUBERNETES_SERVICE_HOST'):
    kubernetes.config.load_incluster_config()
    logger.info("Loaded in-cluster Kubernetes config")
else:
    try:
        kubernetes.config.load_kube_config()
        logger.info("Loaded local Kubernetes config (kubeconfig)")
    except kubernetes.config.ConfigException:
        logger.error("Could not load any Kubernetes config. Ensure KUBECONFIG is set or running in-cluster.")
        raise

# Get Kubernetes API clients
apps_v1 = kubernetes.client.AppsV1Api()
core_v1 = kubernetes.client.CoreV1Api()
custom_objects_api = kubernetes.client.CustomObjectsApi()

# Define the group, version, and plural for our CRD
CRD_GROUP = "uptimizer.com"
CRD_VERSION = "v1alpha1"
CRD_PLURAL = "uptimizerapps"

# Helper function to create owner references
def set_owner_reference(obj, owner_cr):
    """Sets the owner reference for garbage collection."""
    kopf.adopt(obj, owner=owner_cr)

# --- Operator Handlers ---

@kopf.on.create(CRD_GROUP, CRD_VERSION, CRD_PLURAL)
@kopf.on.update(CRD_GROUP, CRD_VERSION, CRD_PLURAL)
@kopf.on.resume(CRD_GROUP, CRD_VERSION, CRD_PLURAL)
def manage_uptimizer_app(spec, name, namespace, uid, logger, body, patch, **kwargs):
    """
    Manages the creation and update of UptimizerApp resources.
    This single handler covers create, update, and resume (operator restart) events.
    """
    logger.info(f"Handling {'update' if 'old' in kwargs else 'create'}/{'resume' if kwargs.get('retry') else ''} for {name} in {namespace}")

    # --- Desired State from CR Spec ---
    image = spec.get('image', 'your-dockerhub-username/uptimizer:latest') # IMPORTANT: Provide a default or make image required in CRD
    replicas = spec.get('replicas', 1)
    app_port = spec.get('port', 5000)
    service_type = spec.get('serviceType', 'ClusterIP') # Or LoadBalancer, NodePort
    config_content_str = spec.get('configJson', '{}') # Get config as string

    # Validate and parse config.json content
    try:
        config_data = json.loads(config_content_str)
        config_json_str_formatted = json.dumps(config_data, indent=2) # Use formatted JSON in CM
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in spec.configJson for {name}: {e}")
        # Use patch to update the CR status with the error
        patch.status['error'] = f"Invalid JSON in spec.configJson: {e}"
        # Optionally raise kopf.PermanentError to stop retries for bad config
        raise kopf.PermanentError(f"Invalid JSON in spec.configJson: {e}")

    # --- Define Resources ---
    app_labels = {'app': 'uptimizer', 'instance': name}
    configmap_name = f"{name}-config"
    deployment_name = f"{name}-deployment"
    service_name = f"{name}-service"

    # 1. ConfigMap Definition
    cm = {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {
            "name": configmap_name,
            "namespace": namespace,
            "labels": app_labels,
        },
        "data": {
            "config.json": config_json_str_formatted
        }
    }

    # 2. Deployment Definition
    deployment = {
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": deployment_name,
            "namespace": namespace,
            "labels": app_labels,
        },
        "spec": {
            "replicas": replicas,
            "selector": {
                "matchLabels": app_labels
            },
            "template": {
                "metadata": {
                    "labels": app_labels
                },
                "spec": {
                    "containers": [{
                        "name": "uptimizer-app",
                        "image": image,
                        "ports": [{"containerPort": app_port}],
                        "env": [
                            # Add any other environment variables needed by the app
                            # Example: {"name": "DATABASE_URL", "valueFrom": {"secretKeyRef": {"name": "db-secret", "key": "url"}}}
                             {"name": "FLASK_RUN_PORT", "value": str(app_port)},
                             {"name": "FLASK_APP", "value": "main.py"}, # From your Dockerfile
                             {"name": "FLASK_RUN_HOST", "value": "0.0.0.0"} # From your Dockerfile
                        ],
                        "volumeMounts": [{
                            "name": "config-volume",
                            "mountPath": "/usr/src/app/config.json", # Mount point inside container
                            "subPath": "config.json" # The key in the ConfigMap data
                        }]
                    }],
                    "volumes": [{
                        "name": "config-volume",
                        "configMap": {
                            "name": configmap_name
                        }
                    }]
                }
            }
        }
    }

    # 3. Service Definition
    service = {
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": {
            "name": service_name,
            "namespace": namespace,
            "labels": app_labels,
        },
        "spec": {
            "selector": app_labels,
            "ports": [{"protocol": "TCP", "port": app_port, "targetPort": app_port}],
            "type": service_type
        }
    }

    # --- Set Owner References ---
    # This ensures that when the UptimizerApp CR is deleted,
    # Kubernetes automatically garbage collects the owned resources (ConfigMap, Deployment, Service).
    set_owner_reference(cm, owner_cr=body)
    set_owner_reference(deployment, owner_cr=body)
    set_owner_reference(service, owner_cr=body)

    # --- Apply Resources ---
    try:
        # Apply ConfigMap
        logger.info(f"Applying ConfigMap {configmap_name}...")
        core_v1.patch_namespaced_config_map(
            name=configmap_name,
            namespace=namespace,
            body=cm,
            field_manager="uptimizer-operator"
        )
        logger.info(f"ConfigMap {configmap_name} patched.")
    except kubernetes.client.ApiException as e:
        if e.status == 404:
            logger.info(f"ConfigMap {configmap_name} not found, creating...")
            core_v1.create_namespaced_config_map(namespace=namespace, body=cm)
            logger.info(f"ConfigMap {configmap_name} created.")
        elif e.status == 409: # Conflict, likely means it's being created/deleted by another process
             logger.warning(f"Conflict patching ConfigMap {configmap_name}. Will retry. Error: {e.reason}")
             raise kopf.TemporaryError(f"Conflict patching ConfigMap {configmap_name}", delay=10)
        else:
            logger.exception(f"Error managing ConfigMap {configmap_name}: {e}")
            raise # Re-raise unexpected errors

    try:
        # Apply Deployment
        logger.info(f"Applying Deployment {deployment_name}...")
        apps_v1.patch_namespaced_deployment(
            name=deployment_name,
            namespace=namespace,
            body=deployment,
            field_manager="uptimizer-operator"
        )
        logger.info(f"Deployment {deployment_name} patched.")
    except kubernetes.client.ApiException as e:
        if e.status == 404:
            logger.info(f"Deployment {deployment_name} not found, creating...")
            apps_v1.create_namespaced_deployment(namespace=namespace, body=deployment)
            logger.info(f"Deployment {deployment_name} created.")
        elif e.status == 409:
            logger.warning(f"Conflict patching Deployment {deployment_name}. Will retry. Error: {e.reason}")
            raise kopf.TemporaryError(f"Conflict patching Deployment {deployment_name}", delay=10)
        else:
            logger.exception(f"Error managing Deployment {deployment_name}: {e}")
            raise

    try:
        # Apply Service
        logger.info(f"Applying Service {service_name}...")
        core_v1.patch_namespaced_service(
            name=service_name,
            namespace=namespace,
            body=service,
            field_manager="uptimizer-operator"
        )
        logger.info(f"Service {service_name} patched.")
    except kubernetes.client.ApiException as e:
        if e.status == 404:
            logger.info(f"Service {service_name} not found, creating...")
            core_v1.create_namespaced_service(namespace=namespace, body=service)
            logger.info(f"Service {service_name} created.")
        elif e.status == 409:
            logger.warning(f"Conflict patching Service {service_name}. Will retry. Error: {e.reason}")
            raise kopf.TemporaryError(f"Conflict patching Service {service_name}", delay=10)
        else:
            logger.exception(f"Error managing Service {service_name}: {e}")
            raise

    logger.info(f"Successfully reconciled {name} in {namespace}.")
    # Update status - simple example
    patch.status['observedGeneration'] = body.metadata.generation
    patch.status['deploymentName'] = deployment_name
    patch.status['serviceName'] = service_name
    patch.status['configMapName'] = configmap_name
    if 'error' in patch.status: # Clear previous error if successful now
        del patch.status['error']

    return {'message': f"Resource {name} managed successfully"} # Optional: return status updates


# Optional: Add a handler for deletion if specific cleanup beyond garbage collection is needed.
# Kopf's owner references usually handle this well for standard resources.
@kopf.on.delete(CRD_GROUP, CRD_VERSION, CRD_PLURAL)
def delete_uptimizer_app(name, namespace, logger, body, **kwargs):
    """
    Handles deletion of the UptimizerApp CR.
    Usually, owner references handle cleanup. Add logic here if needed.
    """
    logger.info(f"Deleting {name} in {namespace}. Kubernetes garbage collection via owner references will handle dependent resources.")
    # Example: If you created external resources not managed by K8s GC, clean them up here.
    return {'message': f"Deletion event processed for {name}"}

# Optional: Add event watchers for dependent resources (Deployment, Service)
# to update the CR status more accurately (e.g., with ready replicas, service IP)
@kopf.on.event(['apps/v1', 'deployments'])
def handle_deployment_event(event, logger, **kwargs):
    dep = event['object']
    if 'ownerReferences' in dep['metadata']:
         for owner_ref in dep['metadata']['ownerReferences']:
            if owner_ref.get('kind') == 'UptimizerApp' and owner_ref.get('apiVersion') == f"{CRD_GROUP}/{CRD_VERSION}":
                cr_name = owner_ref['name']
                cr_namespace = dep['metadata']['namespace']
                logger.info(f"Received event from owned Deployment {dep['metadata']['name']} for UptimizerApp {cr_name}")
                # Here you could fetch the CR and update its status based on deployment conditions
                # Example: update status with number of available replicas
                # try:
                #    cr = custom_objects_api.get_namespaced_custom_object(
                #        group=CRD_GROUP, version=CRD_VERSION, namespace=cr_namespace, plural=CRD_PLURAL, name=cr_name
                #    )
                #    status_patch = {'status': {'readyReplicas': dep.get('status', {}).get('readyReplicas', 0)}}
                #    custom_objects_api.patch_namespaced_custom_object_status(
                #        group=CRD_GROUP, version=CRD_VERSION, namespace=cr_namespace, plural=CRD_PLURAL, name=cr_name, body=status_patch
                #    )
                # except kubernetes.client.ApiException as e:
                #    logger.error(f"Failed to update status for CR {cr_name} from deployment event: {e}")
                pass # Keep it simple for now


# --- Main execution (for local debugging) ---
# Note: When run via Docker/Kubernetes, kopf handles the main loop.
# This __main__ block is primarily for running `python operator.py` locally.
# if __name__ == '__main__':
#     # For local testing, you might need to run `kopf run operator.py --verbose --standalone`
#     # The framework handles the main loop automatically when run as an operator.
#     logger.info("Operator starting - use 'kopf run operator.py' for execution")