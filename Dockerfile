FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.mjs ./
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 80
CMD ["node", "server.mjs"]
