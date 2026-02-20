# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Accept build arguments
ARG VERSION=dev
ARG BUILD_DATE

# Set environment variables for Next.js build
ENV NEXT_PUBLIC_VERSION=${VERSION}
ENV NEXT_PUBLIC_BUILD_DATE=${BUILD_DATE}

COPY package*.json ./
RUN npm ci

# Build app
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine
WORKDIR /app

# Accept build arguments in production stage
ARG VERSION=dev
ARG BUILD_DATE

# Set environment variables for runtime
ENV NEXT_PUBLIC_VERSION=${VERSION}
ENV NEXT_PUBLIC_BUILD_DATE=${BUILD_DATE}

# Copy only what we need
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["npm", "start"]
