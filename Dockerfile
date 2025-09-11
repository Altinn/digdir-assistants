# build image - START
# args without default values
FROM node@sha256:82a1d74c5988b72e839ac01c5bf0f7879a8ffd14ae40d7008016bca6ae12852b as builder
ARG VITE_SLACK_APP_SUPABASE_API_URL=default \
    VITE_SLACK_APP_SUPABASE_ANON_KEY=default


USER root
ENV YARN_CACHE_FOLDER .yarn/cache
RUN corepack enable yarn 

# Create app directory
WORKDIR /usr/src/app

# Copy package manager files first for better layer caching
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy package.json files from workspaces
COPY apps/admin/package.json ./apps/admin/
COPY apps/slack-app/package.json ./apps/slack-app/
COPY packages/assistant-lib/package.json ./packages/assistant-lib/

# Install dependencies (this layer will be cached if package.json files haven't changed)
RUN yarn install

# Copy source code after dependencies are installed
COPY apps/ ./apps/
COPY packages/ ./packages/

# important to prefix envvar with 'VITE_' so that is included in the build artifact
ENV VITE_SLACK_APP_SUPABASE_API_URL=$VITE_SLACK_APP_SUPABASE_API_URL
ENV VITE_SLACK_APP_SUPABASE_ANON_KEY=$VITE_SLACK_APP_SUPABASE_ANON_KEY

RUN yarn build


# production image - START
FROM node:slim@sha256:cadbfafeb6baf87eaaffa40b3640209c4b7fd38cebde65059d15bc39cd636b85 as runner

ENV YARN_CACHE_FOLDER .yarn/cache
ENV NODE_ENV production

# Enable corepack for yarn in production
RUN corepack enable yarn

# Create app directory
WORKDIR /usr/src/app

# Copy only necessary files for production
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/yarn.lock ./
COPY --from=builder /usr/src/app/.yarnrc.yml ./
COPY --from=builder /usr/src/app/.yarn ./.yarn
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/apps/slack-app/dist ./apps/slack-app/dist
COPY --from=builder /usr/src/app/packages/assistant-lib/dist ./packages/assistant-lib/dist

# switch back to non-root user    
USER node

EXPOSE 3000
ENV PORT 3000
CMD yarn run:slack-app
