  
cd ./deploy

#download latest deploy script
aws s3 cp "s3://flipp-platform-production/deploy/library-builder/library-builder-deploy.sh" library-builder-deploy.sh
chmod +x library-builder-deploy.sh

#Execute the deployment Scripts
./library-builder-deploy.sh