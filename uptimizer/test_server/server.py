import time
from flask import Flask, jsonify, make_response

app = Flask(__name__)

@app.route('/ok')
def endpoint_ok():
    """Simulates a healthy endpoint."""
    return jsonify({"status": "OK", "message": "Service is running normally."}), 200

@app.route('/fail')
def endpoint_fail():
    """Simulates a failing endpoint."""
    return jsonify({"status": "Error", "message": "Service is experiencing issues."}), 500

@app.route('/slow')
def endpoint_slow():
    """Simulates a slow endpoint."""
    time.sleep(3) # Simulate 3 seconds delay
    return jsonify({"status": "OK", "message": "Service responded slowly but successfully."}), 200

@app.route('/')
def index():
    """Basic index for the test server."""
    return "Test Server Running. Available endpoints: /ok, /fail, /slow", 200

if __name__ == '__main__':
    # Note: Host/Port are controlled by `flask run` args or ENV vars in Dockerfile/compose
    app.run()