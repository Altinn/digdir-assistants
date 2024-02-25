# digdir-assistants

A mono-repo for generative AI assistants, based on RAG architecture. 

Currently deployed as a Slack application, we also plan to integrate with web applications, in particular Altinn Studio.

# Agent flow 

This diagram shows the main functional blocks and how data flows between them:

![Agent Flow](/documentation/agent-flow.jpg)


## See it in action

[#altinn-assistant](https://altinndevops.slack.com/archives/C06JQLHSZME/p1707478070231209)  on Altinn Devops Slack

## Quickstart

### Install dependencies:  

`$ yarn install`

### Build packages

`$ yarn build:assistant-lib`

### Build slack-app

`$ yarn build:slack-app`


### Run slack-app

`$ yarn run:slack-app`

Note: in order for your local bot endpoint to receive traffic from Slack, you need to configure a proxy service such as `ngrok`, and configure a Slack app to use the URL allocated by ngrok.

