# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install system dependencies if needed (uncomment if psycopg2 build fails)
# RUN apk add --no-cache postgresql-dev gcc python3-dev musl-dev

# Copy the requirements file first to leverage Docker cache
COPY ./app/requirements.txt ./

# Install dependencies
# Using --no-cache-dir is good practice
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code from the app directory
COPY ./app /usr/src/app/

# Make port 5000 available to the world outside this container
EXPOSE 5000

# Define environment variable Defaults (can be overridden in docker-compose)
ENV FLASK_APP=main.py
ENV FLASK_RUN_HOST=0.0.0.0

# Run the command to start Flask development server
# For production, switch to Gunicorn or similar:
# CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "main:app"]
CMD ["flask", "run"]