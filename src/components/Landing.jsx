import { useEffect, useRef } from 'react';
import landingHtml from '../../frontend/landing.html?raw';

export function Landing({ onStart }) {
  const rootRef = useRef(null);

  function handleLandingClick(event) {
    const target = event.target.closest('a, button');
    if (!target) return;
    const label = target.textContent.toLowerCase();
    if (label.includes('start pinging') || label.includes('sign up')) {
      event.preventDefault();
      onStart();
    }
  }

  useEffect(() => {
    const scripts = [...rootRef.current.querySelectorAll('script')];
    const executedScripts = scripts.map((source) => {
      const script = document.createElement('script');
      script.textContent = `(function () {\n${source.textContent}\n})();`;
      document.body.appendChild(script);
      source.remove();
      return script;
    });
    rootRef.current.addEventListener('click', handleLandingClick);

    return () => {
      rootRef.current?.removeEventListener('click', handleLandingClick);
      executedScripts.forEach((script) => script.remove());
    };
  }, [onStart]);

  return <div ref={rootRef} className="landing-page" dangerouslySetInnerHTML={{ __html: landingHtml }} />;
}
