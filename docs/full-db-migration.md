# Full DB Migration

To migrate the complete db to a new location, we need to dump the current db from the current location and then import
it in the new location.
This guide will also include creating the DB in the new location and the user for the application.


## Open DB security group to allow connectivity

```bash
# Set the environment: dev or prd
environment=dev

src_location_sg_name="platform-psql-${environment}"
dst_location_sg_name="platform-serverless-psql-${environment}-*"

if [[ "${environment}" == "dev" ]]; then
  cidr="10.105.0.0/16"
else
  cidr="10.108.0.0/16"
fi

aws_region=eu-west-1
aws_profile=nos-${environment}-breakglass
db_port=5432

# Find the VPC
vpcId=$(
    aws --profile ${aws_profile} --region ${aws_region} ec2 describe-vpcs \
        --filter Name=tag:Name,Values=platform-${environment}-vpc \
    | jq -r '.Vpcs[].VpcId'
)
# Find the security group of the src location
srcSgId=$(
    aws --profile ${aws_profile} --region ${aws_region} ec2 get-security-groups-for-vpc \
        --vpc-id ${vpcId} \
        --filter Name=group-name,Values=${src_location_sg_name} \
    | jq -r '.SecurityGroupForVpcs[].GroupId'
)

# Find the security group of the dst location
dstSgId=$(
    aws --profile ${aws_profile} --region ${aws_region} ec2 get-security-groups-for-vpc \
        --vpc-id ${vpcId} \
        --filter Name=group-name,Values=${dst_location_sg_name} \
    | jq -r '.SecurityGroupForVpcs[].GroupId'
)
  
# Open the src security group
aws --profile ${aws_profile} --region ${aws_region} ec2 authorize-security-group-ingress \
    --group-id ${srcSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr ${cidr}

# Open the dst security group
aws --profile ${aws_profile} --region ${aws_region} ec2 authorize-security-group-ingress \
    --group-id ${dstSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr ${cidr}
```

## Run psql container

Pod definition.
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: blockchain-indexer-db-migration
spec:
  containers:
    - name: main
      image: registry.gitlab.com/nosana-ci/tools/containers/psql:latest
      command: ["tail", "-f", "/dev/null"]
      envFrom:
        - secretRef:
            name: blockchain-indexer-db-credentials
      volumeMounts:
        - mountPath: /data
          name: data
  volumes:
    - name: data
      emptyDir:
        sizeLimit: 10Gi
  imagePullSecrets:
    - name: image-pull
```

Save the definition to a file called `blockchain-indexer-db-migration.yaml`.

Create a secret with DB credentials.
```bash
# Set kubectl context to dev or prd
app_name="blockchain-indexer"
namespace="${app_name}"

if [[ "${environment}" == "dev" ]]; then
  dstDbHostId1PasswordItem="owkv2lmr4rfzb6qkhlsdugd5fa"
else
  dstDbHostId1PasswordItem="a4n7yztbse6p7ymxjx7znkbq7m"
fi

srcDbHost="$(kubectl get deployment -n ${namespace} ${app_name}-api -o json | jq -r '.spec .template .spec .containers[0] .env[] | select(.name=="POSTGRES_HOST") | .value')"
srcMasterUser="$(kubectl get secret -n dashboard dashboard-variable-secrets -o json | jq -r '.data ["POSTGRES_USER"]' | base64 --decode)"
srcMasterPassword="$(kubectl get secret -n dashboard dashboard-variable-secrets -o json | jq -r '.data ["POSTGRES_PASSWORD"]' | base64 --decode)"
srcDbName="$(kubectl get deployment -n ${namespace} ${app_name}-api -o json | jq -r '.spec .template .spec .containers[0] .env[] | select(.name=="POSTGRES_DB") | .value')"
srcDbUser="$(kubectl get secret -n ${namespace} ${app_name}-variable-secrets -o json | jq -r '.data ["POSTGRES_USER"]' | base64 --decode)"
srcDbPassword="$(kubectl get secret -n ${namespace} ${app_name}-variable-secrets -o json | jq -r '.data ["POSTGRES_PASSWORD"]' | base64 --decode)"

dstDbHost="$(nos-op-ops-fetch ${dstDbHostId1PasswordItem} hostname)"
dstMasterUser="$(nos-op-ops-fetch ${dstDbHostId1PasswordItem} username)"
dstMasterPassword="$(nos-op-ops-fetch ${dstDbHostId1PasswordItem} password)"
dstDbName="${srcDbName}"
dstDbUser="${srcDbUser}" 
dstDbPassword="${srcDbPassword}"

kubectl create secret generic blockchain-indexer-db-credentials \
  --from-literal="SRC_DB_HOST=${srcDbHost}" \
  --from-literal="SRC_DEFAULT_DB_NAME=postgres" \
  --from-literal="SRC_DB_MASTER_USERNAME=${srcMasterUser}" \
  --from-literal="SRC_DB_MASTER_PASSWORD=${srcMasterPassword}" \
  --from-literal="SRC_DB_NAME=${srcDbName}" \
  --from-literal="SRC_DB_USER=${srcDbUser}" \
  --from-literal="SRC_DB_PASSWORD=${srcDbPassword}" \
  --from-literal="DST_DB_HOST=${dstDbHost}" \
  --from-literal="DST_DEFAULT_DB_NAME=postgres" \
  --from-literal="DST_DB_MASTER_USERNAME=${dstMasterUser}" \
  --from-literal="DST_DB_MASTER_PASSWORD=${dstMasterPassword}" \
  --from-literal="DST_DB_NAME=${dstDbName}" \
  --from-literal="DST_DB_USERNAME=${dstDbUser}" \
  --from-literal="DST_DB_PASSWORD=${dstDbPassword}"

# Copy image pull secrets
kubectl create secret generic image-pull \
  --type=kubernetes.io/dockerconfigjson \
  --from-literal=".dockerconfigjson=$(kubectl get secret -n ${app_name} ${app_name}-image-pull-secrets -o json | jq -r '.data [".dockerconfigjson"]' | base64 --decode)"

```

Run pod.
```bash
kubectl apply -f blockchain-indexer-db-migration.yaml
```

Get a shell on the pod container.
```bash
kubectl exec -it blockchain-indexer-db-migration -- ash

# Dump the src db
dump-db.sh

# If there are any errors, the script should stop and return code shouldn't be 0
echo $?

ls -al /tmp/${SRC_DB_NAME}.dir

# Create the dst db and the user
create-db-user.sh "all-privileges"

# Restore the src db dump in the dst db
restore-db-dump.sh

# Grant privileges also to the drizzle schema (created in the restore step)
create-db-user.sh "all-privileges" "drizzle"

# If there are any errors, the script should stop and return code shouldn't be 0
echo $?

# Leave the shell and exit the pod
crt^d
```

## Cleanup

Delete pod, secret and configmap.
```bash
kubectl delete -f blockchain-indexer-db-migration.yaml --force=true
kubectl delete secret blockchain-indexer-db-credentials
kubectl delete secret image-pull
```

Close off security group.
```bash
aws --profile ${aws_profile} --region ${aws_region} ec2 revoke-security-group-ingress \
    --group-id ${srcSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr ${cidr}

aws --profile ${aws_profile} --region ${aws_region} ec2 revoke-security-group-ingress \
    --group-id ${dstSgId} \
    --protocol tcp \
    --port ${db_port} \
    --cidr ${cidr}
```
