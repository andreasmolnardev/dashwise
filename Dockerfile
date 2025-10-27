# Build stage
FROM node:18-alpine AS builder
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build Next.js app
RUN npm run build

# Final stage
FROM node:18-alpine
WORKDIR /app

# Copy built app and only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Expose port
EXPOSE 3000

# Start production server
CMD ["npm", "start"]
