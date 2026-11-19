# syntax=docker/dockerfile:1
# Build: Vite produces a static site (the OCR runs in visitors' browsers).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Donation/repo links are baked in at build time (see .env.example).
ARG VITE_PROMPTPAY_ID=""
ARG VITE_DONATE_URL=""
ARG VITE_REPO_URL=""
ARG VITE_CONTACT_EMAIL=""
ENV VITE_PROMPTPAY_ID=$VITE_PROMPTPAY_ID VITE_DONATE_URL=$VITE_DONATE_URL VITE_REPO_URL=$VITE_REPO_URL VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL
# `prebuild` downloads the pinned, checksum-verified model files from Hugging Face.
RUN npm run build

# Serve: unprivileged nginx (listens on 8080, runs as a non-root user).
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
