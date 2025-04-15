import os
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from functools import wraps
from flask import request, jsonify, current_app

# --- Token Generation / Verification ---

_serializer = None

def get_serializer():
    """Initializes and returns the timed serializer."""
    global _serializer
    if _serializer is None:
        secret = current_app.config.get('SECRET_KEY')
        if not secret:
            raise ValueError("SECRET_KEY is not set in Flask app configuration.")
        # Use a salt specific to client API tokens for better isolation
        _serializer = URLSafeTimedSerializer(secret, salt='uptimizer-client-api-token')
    return _serializer

def generate_client_api_token(client_id: str) -> str:
    """Generates a signed, non-expiring token containing the client_id."""
    serializer = get_serializer()
    return serializer.dumps(client_id)

def verify_client_api_token(token: str) -> str | None:
    """
    Verifies the signed token.
    Returns the client_id if valid, None otherwise.
    Does not check expiration as these tokens are meant to be long-lived
    and manually revocable by regeneration.
    """
    serializer = get_serializer()
    try:
        # We load without max_age check
        client_id = serializer.loads(token)
        return client_id
    except BadSignature:
        current_app.logger.warning(f"Token verification failed: Bad Signature. Token: {token[:10]}...")
        return None
    except Exception as e:
        # Catch other potential errors during loads
        current_app.logger.error(f"Unexpected error verifying token: {e}. Token: {token[:10]}...")
        return None

# --- Decorator for API Authentication ---

def token_required(f):
    """Decorator to protect API endpoints requiring a valid client API token."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = None
        # Check for token in Authorization header (Bearer scheme)
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == 'bearer':
                token = parts[1]
            else:
                 current_app.logger.warning("Invalid Authorization header format.")

        if not token:
             # Allow token via query parameter as a fallback (less secure)
             token = request.args.get('token')
             if token:
                 current_app.logger.debug("Token provided via query parameter.")

        if not token:
            current_app.logger.warning("API access denied: Token is missing.")
            return jsonify({"error": "Authentication Token is missing!"}), 401

        # Verify the token using the function above
        verified_client_id = verify_client_api_token(token)

        if not verified_client_id:
            current_app.logger.warning(f"API access denied: Token is invalid. Token: {token[:10]}...")
            return jsonify({"error": "Invalid or expired Authentication Token!"}), 401

        # Check if the client_id extracted from the token matches the client_id in the URL path
        # This prevents a token for client 'A' being used to access client 'B's data
        url_client_id = kwargs.get('client_id')
        if url_client_id and verified_client_id != url_client_id:
             current_app.logger.warning(f"API access denied: Token client ID ('{verified_client_id}') does not match URL client ID ('{url_client_id}').")
             return jsonify({"error": "Token does not match the requested client resource."}), 403 # Forbidden

        current_app.logger.debug(f"Token verified successfully for client_id: {verified_client_id}")
        # Inject verified client ID into kwargs for the route function if needed,
        # although primary check is done above.
        kwargs['verified_client_id'] = verified_client_id

        return f(*args, **kwargs)
    return decorated_function