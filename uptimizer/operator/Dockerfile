# Use the same Python base as your app or a suitable slim version
FROM python:3.11-slim

WORKDIR /usr/src/operator

# Install necessary libraries
COPY requirements.txt ./
# Using --no-cache-dir is good practice
RUN pip install --no-cache-dir -r requirements.txt

# Copy the operator code
COPY operator.py ./

# Command to run the operator using Kopf
# Adjust log level as needed (--verbose or --quiet)
CMD ["kopf", "run", "/usr/src/operator/operator.py", "-- Loglevel=info"]