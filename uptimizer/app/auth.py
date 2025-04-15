# File Name: auth.py
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\auth.py
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
            # Log the error specifically when serializer is needed
            current_app.logger.error("CRITICAL: SECRET_KEY is not set. Cannot initialize token serializer.")
            raise ValueError("SECRET_KEY is not set in Flask app configuration.")
        # Use a salt specific to client API tokens for better isolation
        _serializer = URLSafeTimedSerializer(secret, salt='uptimizer-client-api-token')
        current_app.logger.info("Token serializer initialized successfully.")
    return _serializer

def generate_client_api_token(client_id: str) -> str:
    """Generates a signed, non-expiring token containing the client_id."""
    # This function will raise ValueError if SECRET_KEY is missing via get_serializer()
    serializer = get_serializer()
    return serializer.dumps(client_id)

def verify_client_api_token(token: str) -> str | None:
    """
    Verifies the signed token.
    Returns the client_id if valid, None otherwise.
    Does not check expiration as these tokens are meant to be long-lived
    and manually revocable by regeneration.
    """
    try:
        # Try to get serializer. If SECRET_KEY is missing, this will raise ValueError.
        serializer = get_serializer()
        # We load without max_age check
        client_id = serializer.loads(token)
        return client_id
    except ValueError as e: # Catch SECRET_KEY missing error
        current_app.logger.error(f"Token verification failed: {e}")
        return None
    except BadSignature:
        # Log at warning level, include partial token for debugging
        current_app.logger.warning(f"Token verification failed: Bad Signature. Token starts with: {token[:10]}...")
        return None
    except Exception as e:
        # Catch other potential errors during loads (e.g., malformed token)
        current_app.logger.error(f"Unexpected error verifying token: {e}. Token starts with: {token[:10]}...")
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
                 # Log if format is wrong but header exists
                 current_app.logger.warning("Invalid Authorization header format received.")

        # Fallback: Check query parameter (less secure, but allowed)
        if not token:
             token = request.args.get('token')
             if token:
                 current_app.logger.debug("Token provided via query parameter.")

        if not token:
            current_app.logger.warning("API access denied: Token is missing.")
            # Return 401 Unauthorized
            return jsonify({"error": "Authentication Token is missing!"}), 401

        # Verify the token using the function above
        # This now handles the case where SECRET_KEY might be missing during verification
        verified_client_id = verify_client_api_token(token)

        if not verified_client_id:
            # Error already logged in verify_client_api_token if invalid/error
            # Return 401 Unauthorized for invalid/expired/unverifiable tokens
            return jsonify({"error": "Invalid or unverifiable Authentication Token!"}), 401

        # Check if the client_id extracted from the token matches the client_id in the URL path
        # This prevents a token for client 'A' being used to access client 'B's data
        url_client_id = kwargs.get('client_id') # Assumes client_id is a URL variable
        if url_client_id and verified_client_id != url_client_id:
             current_app.logger.warning(f"API access denied: Token client ID ('{verified_client_id}') does not match URL client ID ('{url_client_id}').")
             # Return 403 Forbidden if token is valid but for the wrong resource
             return jsonify({"error": "Token does not match the requested client resource."}), 403

        # Token is valid and matches the resource (if applicable)
        current_app.logger.debug(f"Token verified successfully for client_id: {verified_client_id}")

        # Inject verified client ID into kwargs for the route function,
        # useful if the route needs the ID confirmed by the token.
        kwargs['verified_client_id'] = verified_client_id

        # Proceed to the decorated route function
        return f(*args, **kwargs)
    return decorated_function
