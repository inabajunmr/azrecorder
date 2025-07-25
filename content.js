// ARCollector - Content Script
// Bridges between inject.js and extension storage

(function () {
  "use strict";

  const STORAGE_KEY = "oauth_flows_data";
  const MAX_FLOWS = 100; // Limit to prevent storage bloat

  // Generate flow ID from client_id and redirect_uri
  function generateFlowId(clientId, redirectUri) {
    if (!clientId || !redirectUri) {
      return Date.now().toString() + Math.random().toString(36).substr(2, 9);
    }
    const combined = `${clientId}|${redirectUri}`;
    return btoa(combined)
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 16);
  }

  // Clean old flows to maintain storage limit
  async function cleanOldFlows(flows) {
    const flowEntries = Object.entries(flows);
    if (flowEntries.length <= MAX_FLOWS) return flows;

    // Sort by creation time and keep the most recent
    flowEntries.sort((a, b) => {
      const aTime = new Date(a[1].created_at).getTime();
      const bTime = new Date(b[1].created_at).getTime();
      return bTime - aTime;
    });

    const cleanedFlows = {};
    flowEntries.slice(0, MAX_FLOWS).forEach(([key, value]) => {
      cleanedFlows[key] = value;
    });

    return cleanedFlows;
  }

  // Load existing flows from storage
  async function loadFlows() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || {};
    } catch (error) {
      console.error("[ARCollector] Error loading flows:", error);
      return {};
    }
  }

  // Save flows to storage
  async function saveFlows(flows) {
    try {
      const cleanedFlows = await cleanOldFlows(flows);
      await chrome.storage.local.set({ [STORAGE_KEY]: cleanedFlows });
      console.log(
        "[ARCollector] Flows saved:",
        Object.keys(cleanedFlows).length
      );
    } catch (error) {
      console.error("[ARCollector] Error saving flows:", error);
    }
  }

  // Handle authorization request (delegate to background script)
  async function handleAuthorizationRequest(data) {
    console.log(
      "[ARCollector] Content script detected auth request, delegating to background"
    );
    // Let background script handle it to prevent duplicates
  }

  // Handle authorization response (send to background script)
  async function handleAuthorizationResponse(data) {
    console.log(
      "[ARCollector] Content script detected auth response, sending to background"
    );

    // Send to background script for centralized processing
    try {
      await chrome.runtime.sendMessage({
        action: "authorizationResponse",
        url: data.url,
        parameters: data.parameters,
        timestamp: data.timestamp,
        response_type: data.response_type,
        redirect_uri: data.redirect_uri,
        state: data.state,
      });
    } catch (error) {
      console.error(
        "[ARCollector] Error sending auth response to background:",
        error
      );
    }
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
      return {};
    }
  }

  // Check if URL contains authorization request
  function isAuthorizationRequest(url, params) {
    return !!params.client_id;
  }

  // Check if URL contains authorization response
  function isAuthorizationResponse(url, params) {
    // Success response: has code, access_token, or id_token
    const hasSuccessParams =
      params.code || params.access_token || params.id_token;

    // Error response: has error parameter
    const hasErrorParams = params.error;

    // Should have state parameter (CSRF protection)
    const hasState = params.state;

    return (hasSuccessParams || hasErrorParams) && hasState;
  }

  // Monitor current page URL immediately (for fast redirects)
  function monitorCurrentPage() {
    const currentUrl = window.location.href;
    const params = parseUrlParameters(currentUrl);

    if (isAuthorizationRequest(currentUrl, params)) {
      const authRequest = {
        type: "authorization_request",
        timestamp: new Date().toISOString(),
        url: currentUrl,
        parameters: params,
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        response_type: params.response_type,
        scope: params.scope,
        state: params.state,
        nonce: params.nonce,
      };

      console.log(
        "[ARCollector] Authorization Request detected (content script):",
        authRequest
      );
      handleAuthorizationRequest(authRequest);
    } else if (isAuthorizationResponse(currentUrl, params)) {
      const responseType = params.error ? "error" : "success";

      const authResponse = {
        type: "authorization_response",
        timestamp: new Date().toISOString(),
        url: currentUrl,
        response_type: responseType,
        parameters: params,
        redirect_uri: window.location.origin + window.location.pathname,
        state: params.state,
      };

      console.log(
        "[ARCollector] Authorization Response detected (content script):",
        authResponse
      );
      handleAuthorizationResponse(authResponse);
    }
  }

  // Listen for messages from inject script
  window.addEventListener("message", async (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.source !== "arcollector-inject"
    ) {
      return;
    }

    const data = event.data.data;

    try {
      if (data.type === "authorization_request") {
        await handleAuthorizationRequest(data);
      } else if (data.type === "authorization_response") {
        await handleAuthorizationResponse(data);
      }
    } catch (error) {
      console.error("[ARCollector] Error handling message:", error);
    }
  });

  // Listen for messages from background script
  if (
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    chrome.runtime.onMessage
  ) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "debug_info") {
        console.log("[ARCollector] Background debug:", message.message);
      }
      sendResponse({ received: true });
    });
  }

  // Inject the monitoring script
  function injectScript() {
    // Check if chrome.runtime is available
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.getURL
    ) {
      try {
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("inject.js");
        script.onload = function () {
          this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
        console.log("[ARCollector] External script injected successfully");
        return;
      } catch (error) {
        console.error("[ARCollector] Error injecting external script:", error);
      }
    }

    // Fallback: inject script content directly
    console.log("[ARCollector] Using direct injection fallback");
    injectScriptDirectly();
  }

  // Fallback method to inject script content directly
  function injectScriptDirectly() {
    const script = document.createElement("script");
    script.textContent = `
      // Minimal injection for OAuth monitoring
      (function() {
        console.log('[ARCollector] Direct injection fallback');
        
        function parseUrlParameters(url) {
          try {
            const urlObj = new URL(url);
            const params = {};
            for (const [key, value] of urlObj.searchParams) {
              params[key] = value;
            }
            if (urlObj.hash) {
              const fragmentParams = new URLSearchParams(urlObj.hash.substring(1));
              for (const [key, value] of fragmentParams) {
                params[key] = value;
              }
            }
            return params;
          } catch (error) {
            return {};
          }
        }
        
        function isAuthorizationRequest(url, params) {
          if (!params.client_id || !params.response_type) return false;
          return true;
        }
        
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
              nonce: params.nonce
            };
            
            window.postMessage({
              source: 'arcollector-inject',
              data: authRequest
            }, '*');
          }
        }
        
        // Monitor immediately and on navigation
        monitorUrlChanges();
        window.addEventListener('popstate', () => setTimeout(monitorUrlChanges, 100));
        
        let lastUrl = window.location.href;
        setInterval(() => {
          if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            monitorUrlChanges();
          }
        }, 1000);
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
  }

  // Monitor current page immediately
  monitorCurrentPage();

  // Inject script when DOM is ready or immediately if already ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectScript);
  } else {
    injectScript();
  }

  console.log("[ARCollector] Content script loaded");
})();
