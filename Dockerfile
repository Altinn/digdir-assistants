# args without default values
FROM node as builder
ARG VITE_SLACK_APP_SUPABASE_API_URL=default \
    VITE_SLACK_APP_SUPABASE_ANON_KEY=default

ENV YARN_VERSION 4.2.2
USER root
RUN corepack enable yarn \
    && yarn policies set-version $YARN_VERSION

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY .yarn ./.yarn
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY package.json yarn.lock ./

# important to preview env var with VITE so that is included in the build artifact
ENV VITE_SLACK_APP_SUPABASE_API_URL=$VITE_SLACK_APP_SUPABASE_API_URL
ENV VITE_SLACK_APP_SUPABASE_ANON_KEY=$VITE_SLACK_APP_SUPABASE_ANON_KEY


# DEBUG: print environment vars
# RUN export

RUN yarn install --immutable
RUN yarn build

FROM node:slim as runner

ENV NODE_ENV production
ENV YARN_VERSION 4.2.2
USER root
RUN corepack enable yarn \
    && yarn policies set-version $YARN_VERSION

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY .yarn ./.yarn
COPY package.json yarn.lock ./

RUN yarn workspaces focus --production

COPY --from=builder /usr/src/app/ .

EXPOSE 3000
USER node
CMD export; yarn run:slack-app
