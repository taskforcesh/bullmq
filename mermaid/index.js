let path = null;

setInterval(() => {
  if (path !== window.location.pathname) {
    path = window.location.pathname;
    document.querySelectorAll('.lang-mermaid').forEach(node => {
      const newNode = node.cloneNode(true);
      newNode.removeAttribute('class');
      const hr = document.createElement('hr');
      node.parentNode.insertBefore(hr, node);
      node.parentNode.insertBefore(newNode, hr);
    });
    window.mermaid.initialize({ theme: 'default' });
    window.mermaid.init(undefined, document.querySelectorAll('.lang-mermaid'));
  }
}, 1000);
