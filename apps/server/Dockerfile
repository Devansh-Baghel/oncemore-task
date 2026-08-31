# Cloud Run (us-east1) — use this instead of App Engine if you want
# proximity to Bedrock (us-east-1) and no asia-south1 cross-continent latency.
# App Engine locationId (asia-south1) is immutable per project; Cloud Run lets
# you pick any region per service.

FROM node:22-slim

WORKDIR /app

# Install deps with npm (uses .npmrc legacy-peer-deps). Copy only server package
# plus prebuilt dist (tsdown already bundled @oncemore/*). No need for monorepo.
COPY package.json .npmrc ./
COPY dist ./dist
RUN npm install --omit=dev --ignore-scripts

# Env vars are set via `gcloud run deploy --set-env-vars` or Cloud Run console.
# Do NOT bake secrets into image. app.yaml env_variables are App Engine only.

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "dist/index.mjs"]
