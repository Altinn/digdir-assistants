# build image - START
# args without default values
FROM node as builder
ARG VITE_SLACK_APP_SUPABASE_API_URL=default \
    VITE_SLACK_APP_SUPABASE_ANON_KEY=default


USER root
ENV YARN_VERSION 4.2.2
ENV YARN_CACHE_FOLDER .yarn/cache
RUN corepack enable yarn
RUN yarn policies set-version $YARN_VERSION \
    && yarn -v 

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY .yarn ./.yarn
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY package.json yarn.lock ./

# important to prefix envvar with 'VITE_' so that is included in the build artifact
ENV VITE_SLACK_APP_SUPABASE_API_URL=$VITE_SLACK_APP_SUPABASE_API_URL
ENV VITE_SLACK_APP_SUPABASE_ANON_KEY=$VITE_SLACK_APP_SUPABASE_ANON_KEY

RUN yarn install
RUN yarn build

COPY . .


# production image - START
FROM node:slim as runner

ENV YARN_CACHE_FOLDER .yarn/cache
ENV NODE_ENV production

# switch back to non-root user    
USER node

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY --from=builder /usr/src/app/ .

RUN yarn workspaces focus --production

EXPOSE 3000
CMD node ./apps/slack-app/dist/src/app.js
