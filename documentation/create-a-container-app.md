
# Create a Container App - step by step

### Step 1

- Select your new resource group and Container Apps Environment

![Create a Container app - step 1](/documentation/azure/new-container-app_step-1.png)

---


### Step 2

- Be sure to select the correct repository and image name. 
- The image tag is not important, as we will specific a dynamic git commit in the deployment workflow.
   
![Create a Container app - step 2](/documentation/azure/new-container-app_step-2.jpg)

---

### Step 3

Recommended settings:
- Ingress should be enabled and ***Accepting traffic from anywhere***
- Ingress type: HTTP
- Client certificate mode: Ignore
- Transport: Auto
- Insecure connections: false
- Target port: 3000
- Session affinity: false
   
![Create a Container app - step 3](/documentation/azure/new-container-app_step-3.jpg)



### Step 4

Configure continuous integration:
- Sign-in with your Github credentials, allowing Azure to access the repository and store required secrets
- Select the correct Organization, Repository and Branch to match your own fork.
- Configure Registry settings to match your new Docker image repository.
- Azure access: 
  - Important: as of this writing, User-assigned identity does NOT work with Github Action secrets. Instead, select Service Principal.
- Click "Start continuous deployment"
  - This will generate and commit a new Github Action workflow file in the `.github` folder of your code repository. 
  - Unfortunately, the template used is out of date and needs to be manually updated in a separate commit. We'll fix this in the last step.


![Setup CI](/documentation/azure/setup-ci_step-1.png)



### Step 5 - Add environment to Github actions config

- Under "Environments", add a suitable environment name, ex. "prod-slack-<your-slack-workspace-name>"

![Setup environments in Github](/documentation/github/setup-environments.jpg)


### Step 6 - configure Supabase variables

In your Supabase project settings area, under "API", locate your ANON KEY and project url. You will use these values in the next step.

![Supabase project settings](/documentation/supabase/locate-project-settings.jpg)


### Step 7 - Set environment secrets

Under "Secrets and variables" > "Actions", add the following variables for *each* environment:
  - SLACK_APP_SUPABASE_ANON_KEY

  
You will note that there are some existing secrets under "Repository secrets", created for you by the Azure Container App CI setup wizard. You shouldn't need to modify these, except to cleanup any removed Container Apps.

![Setup environment secrets](/documentation/github/environment-secrets.jpg)


### Step 8 - Set repository variables

Still under "Secrets and variables", click "Variables".

Add the listed repository variables first, adjusting the values as desired. These values serve as a useful default for all environments, reducing the number of environment variables to maintain.



![Setup repository variables](/documentation/github/set-repository-variables.jpg)


### Step 9 - Set Environment variables

Finally, add environment specific variable values for each repository variable you want to override the default value of. Typical examples include:
- SLACK_APP_SUPABASE_API_URL
- TYPESENSE_DOCS_COLLECTION
- TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION


### Step 10 - Set container secrets

Add the following secrets to the container app using the Azure portal:

![Setup Azure container app secrets](/documentation/azure/create-secrets.jpg)


You will find your Slack secrets in the Slack app configuration UI.

### Step 11 - Fix deployment workflow

 See workflows in the `.github` folder for working examples.

 Adjust the generated workflow file to be similar to one of the working examples, substituting the correct environment name where applicable.

 Confirm that Github action for build-and-deploy is successful. 

 ### Step 12 - Change scaling and activation config

 By default, your Container app will scale to zero instances. For environments with sporadic usage, this can be acceptable. However, for most test and production environments, this will cause an unacceptable delay for Slack users.

 We recommend changing the scale configuration to a minimum of 1 instance, to avoid latency due to cold start.

For development and test environments, we recommend Revision mode: Single. 

For production environments, we recommend Revision mode: Multiple, as it makes it much easier to rollback to a known good container instance, should there be problems with a deploy.