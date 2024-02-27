# Use a lightweight Node.js Alpine Linux-based image
FROM node:latest

# Set the working directory inside the container
WORKDIR /app

# Copy the application code to the container
COPY . /app

# Install dependencies and prepare the app for running
RUN npm install

# Expose the desired port (port 3000 in this case)
EXPOSE 3000

# Start the application when the container runs
CMD ["node", "app.js"]