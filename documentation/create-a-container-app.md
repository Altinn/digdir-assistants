
# Create a Container App - step by step

### Step 1

- Select your new resource group and Container Apps Environment

![Create a Container app - step 1](/documentation/azure/new-container-app_step-1.jpg)

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
  - Unfortunately, the template used is out of date and needs to be manually updated in a separate commit. We'll fix this in the next step.


![Setup CI](/documentation/azure/setup-ci_step-1.jpg)



### Step 5 - Fix deployment workflow

 See workflows in the `.github` folder for working examples.
- Add environments and variables to Github 
  - Under "Environments", add a suitable environment name, ex. "test-slack-<your-slack-workspace-name>"

![Setup environments in Github](/documentation/github/setup-environments.jpg)


### Step 6 - configure Supabase variables

In your Supabase project settings area, under "API", locate your ANON KEY and project url. You will use these values in the next step.

![Supabase project settings](/documentation/supabase/locate-project-settings.jpg)


### Step 7 - Set environment secrets

Under "Secrets and variables" > "Actions", add the following variables for *each* environment:
  - SLACK_APP_SUPABASE_ANON_KEY
  - SLACK_APP_SUPABASE_API_URL
  
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


