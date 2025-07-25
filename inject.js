// ARCollector - OAuth2.0/OpenID Connect Authorization Request Collector
// Injected script that runs in page context to monitor authorization flows

(function() {
  'use strict';


  // Generate flow ID from redirect_uri and client_id
  function generateFlowId(clientId, redirectUri) {
    const combined = `${clientId}|${redirectUri}`;
    return btoa(combined).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  }

  // Parse URL parameters (both query and fragment)
  function parseUrlParameters(url) {
    try {
      const urlObj = new URL(url);
      const params = {};
      
      // Parse query parameters
      for (const [key, value] of urlObj.searchParams) {
        params[key] = value;
      }
      
      // Parse fragment parameters (for implicit flow)
      if (urlObj.hash) {
        const fragmentParams = new URLSearchParams(urlObj.hash.substring(1));
        for (const [key, value] of fragmentParams) {
          params[key] = value;
        }
      }
      
      return params;
    } catch (error) {
      console.warn('[ARCollector] Failed to parse URL:', url, error);
      return {};
    }
  }

  // Check if URL contains authorization request
  function isAuthorizationRequest(url, params) {
    // Must have client_id parameter
    if (!params.client_id) return false;
    
    // Should have response_type
    if (!params.response_type) return false;
    
    return true;
  }

  // Check if URL contains authorization response
  function isAuthorizationResponse(url, params) {
    // Success response: has code, access_token, or id_token
    const hasSuccessParams = params.code || params.access_token || params.id_token;
    
    // Error response: has error parameter
    const hasErrorParams = params.error;
    
    // Should have state parameter (CSRF protection)
    const hasState = params.state;
    
    return (hasSuccessParams || hasErrorParams) && hasState;
  }

  // Monitor URL changes for authorization flows
  function monitorUrlChanges() {
    const currentUrl = window.location.href;
    const params = parseUrlParameters(currentUrl);
    
    if (isAuthorizationRequest(currentUrl, params)) {
      const authRequest = {
        type: 'authorization_request',
        timestamp: new Date().toISOString(),
        url: currentUrl,
        parameters: params,
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        response_type: params.response_type,
        scope: params.scope,
        state: params.state,
        nonce: params.nonce // OpenID Connect
      };
      
      console.log('[ARCollector] Authorization Request detected:', authRequest);
      
      window.postMessage({
        source: 'arcollector-inject',
        data: authRequest
      }, '*');
      
    } else if (isAuthorizationResponse(currentUrl, params)) {
      const responseType = params.error ? 'error' : 'success';
      
      const authResponse = {
        type: 'authorization_response',
        timestamp: new Date().toISOString(),
        url: currentUrl,
        response_type: responseType,
        parameters: params,
        redirect_uri: window.location.origin + window.location.pathname,
        state: params.state
      };
      
      console.log('[ARCollector] Authorization Response detected:', authResponse);
      
      window.postMessage({
        source: 'arcollector-inject',
        data: authResponse
      }, '*');
    }
  }

  // Monitor page load for authorization requests (handles 302 redirects)
  function monitorPageLoad() {
    // Check immediately on load
    monitorUrlChanges();
    
    // Also check after a short delay to catch redirects
    setTimeout(monitorUrlChanges, 100);
    setTimeout(monitorUrlChanges, 500);
  }

  // Safer method: Monitor link clicks for authorization requests
  function monitorLinkClicks() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('a');
      if (target && target.href) {
        try {
          const params = parseUrlParameters(target.href);
          if (isAuthorizationRequest(target.href, params)) {
            // Delay slightly to allow navigation to start
            setTimeout(() => {
              const authRequest = {
                type: 'authorization_request',
                timestamp: new Date().toISOString(),
                url: target.href,
                parameters: params,
                client_id: params.client_id,
                redirect_uri: params.redirect_uri,
                response_type: params.response_type,
                scope: params.scope,
                state: params.state,
                nonce: params.nonce
              };
              
              console.log('[ARCollector] Authorization Request detected via link:', authRequest);
              
              window.postMessage({
                source: 'arcollector-inject',
                data: authRequest
              }, '*');
            }, 50);
          }
        } catch (error) {
          // Ignore invalid URLs
        }
      }
    }, true);
  }

  // Initialize monitoring functions
  function initializeMonitoring() {
    monitorPageLoad();
    monitorLinkClicks();
  }

  // Monitor initial page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMonitoring);
  } else {
    initializeMonitoring();
  }

  // Monitor page load events (for direct navigation)
  window.addEventListener('load', monitorPageLoad);
  
  // Monitor beforeunload to catch navigation starts
  window.addEventListener('beforeunload', () => {
    // Store the current URL to check for authorization requests in the next page
    try {
      sessionStorage.setItem('arcollector_last_url', window.location.href);
    } catch (e) {
      // Ignore sessionStorage errors
    }
  });

  // Monitor URL changes (for SPA applications)
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(monitorUrlChanges, 100); // Small delay for URL to stabilize
    }
  });

  // Safe observer initialization
  if (document.body) {
    urlObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        urlObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
    });
  }

  // Monitor popstate events (back/forward navigation)  
  window.addEventListener('popstate', () => {
    setTimeout(monitorUrlChanges, 100);
  });

  // Monitor pushstate/replacestate (programmatic navigation) - safer approach
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    const result = originalPushState.apply(this, args);
    setTimeout(monitorUrlChanges, 100);
    return result;
  };
  
  history.replaceState = function(...args) {
    const result = originalReplaceState.apply(this, args);
    setTimeout(monitorUrlChanges, 100);
    return result;
  };

  console.log('[ARCollector] Injection script loaded');
})();