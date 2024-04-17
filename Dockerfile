ARG SLACK_APP_SUPABASE_API_URL=empty-default \
    SLACK_APP_SUPABASE_ANON_KEY=empty-default
FROM node as builder

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json yarn.lock ./
COPY apps/ ./apps/
COPY packages/ ./packages/

# important to preview env var with VITE so that is included in the build artifact
ENV VITE_SLACK_APP_SUPABASE_API_URL=$SLACK_APP_SUPABASE_API_URL
ENV VITE_SLACK_APP_SUPABASE_ANON_KEY=$SLACK_APP_SUPABASE_ANON_KEY

# verify environment vars
RUN export

RUN yarn install --frozen-lockfile 
RUN yarn build

FROM node:slim as runner

ENV NODE_ENV production
USER node

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json yarn.lock ./

RUN yarn install --production --frozen-lockfile

COPY --from=builder /usr/src/app/ .

EXPOSE 3000
CMD export; yarn run:slack-app