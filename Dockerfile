# Use Node.js 20 (alpine) as the base
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package manifests and install production deps
COPY package*.json ./
RUN npm ci --only=production

# Copy app source code
COPY . .

# Expose the app’s port
EXPOSE 8080

# Start the app
CMD ["node", "index.js"]