FROM node:24-alpine AS builder

WORKDIR /app
COPY api-ts/package*.json ./
RUN npm ci
COPY api-ts/ ./
COPY database /database
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY api-ts/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /database /database

EXPOSE 3000
CMD ["npm", "start"]
