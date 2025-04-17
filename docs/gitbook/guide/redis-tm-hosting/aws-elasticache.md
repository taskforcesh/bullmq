# AWS Elasticache

Elasticache is a managed caching service offered by Amazon Web Services (AWS), and it can be a good option when using BullMQ within the AWS infrastructure.

Here are some points to consider when using Elasticache with BullMQ within AWS:

1. Use the standard cache-nodes setup (i.e. not the serverless version, as serverless for the moment uses an incompatible maxmemory-policy)
2. In order to access your Elasticache instance you will need to create a security group that allows the instance to be accessible to the services running BullMQ instances.&#x20;
3. 
<figure><img src="../../.gitbook/assets/image.png" alt=""><figcaption></figcaption></figure>
4. You will need to specify a VPC and an Inbound rule. Most likely just a custom TCP with port range 6379 and some suitable source (anywhere works well for testing and in some simpler cases), remember that the cluster will not be accessible outside from AWS in any case.
5. Attach the security group to your Elasticache cluster and to the services that need to access it.
6. Make sure that you are using maxmemory-policy: noeviction in your Redis parameters. As you cannot modify any default parameter group you will need to create a new one.

    1. Go to Elasticache > Parameter Groups and click on Create.
    2. Fill name, description, and Family, at the time of writing redis7 is the newest and the recommended one.

    <figure><img src="../../.gitbook/assets/image (1).png" alt=""><figcaption></figcaption></figure>
7. Click on "Create". Then find the parameter group in the list. Click on Edit parameter values and then search for maxmemory-policy:

<figure><img src="../../.gitbook/assets/image (1) (1).png" alt=""><figcaption></figcaption></figure>

8. Change the value to "noeviction":

<figure><img src="../../.gitbook/assets/image (2).png" alt=""><figcaption></figcaption></figure>

9. Save changes. Now you can go to your elasticache cluster and change the parameter group to your custom group. Just find your instance, click on modify and go to cluster settings where you can change the parameter group:

<figure><img src="../../.gitbook/assets/image (3).png" alt=""><figcaption></figcaption></figure>

10. Preview changes and Modify. After this your cluster is ready to be used with BullMQ.

