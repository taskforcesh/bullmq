---
description: Make parent process if any children fails
---

# Continue Parent

With the continueParentOnFailure option, we can make a parent job start processing as soon as one of its children fails. A pattern where this option can be useful is if you want to get rid of the rest of the children as soon as one of the children fail. You can use the parent job to perform some clean ups and remove the rest of the unprocessed children.&#x20;

