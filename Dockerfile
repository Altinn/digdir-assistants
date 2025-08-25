# build image - START
# args without default values
FROM node@sha256:d2b6b5aedb5b729f68ee1129e0f5a5d4713d93f82448249e82241876d8e8d86e AS builder
ARG VITE_SLACK_APP_SUPABASE_API_URL=default \
    VITE_SLACK_APP_SUPABASE_ANON_KEY=default


USER root
ENV YARN_CACHE_FOLDER=.yarn/cache
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
FROM node:slim@sha256:9b741b28148b0195d62fa456ed84dd6c953c1f17a3761f3e6e6797a754d9edff AS runner

ENV YARN_CACHE_FOLDER=.yarn/cache
ENV NODE_ENV=production

# Enable corepack for yarn in production
RUN corepack enable yarn

# Create app directory
WORKDIR /usr/src/app

# Copy workspace configuration and package files
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/yarn.lock ./
COPY --from=builder /usr/src/app/.yarnrc.yml ./
COPY --from=builder /usr/src/app/.yarn ./.yarn

# Copy workspace package.json files (needed for yarn workspaces)
COPY --from=builder /usr/src/app/apps/slack-app/package.json ./apps/slack-app/
COPY --from=builder /usr/src/app/packages/assistant-lib/package.json ./packages/assistant-lib/

# Install production dependencies
RUN yarn workspaces focus --production

# Copy built artifacts
COPY --from=builder /usr/src/app/apps/slack-app/dist ./apps/slack-app/dist
COPY --from=builder /usr/src/app/packages/assistant-lib/dist ./packages/assistant-lib/dist

# switch back to non-root user    
USER node

EXPOSE 3000
ENV PORT=3000
CMD ["yarn", "run:slack-app"]
