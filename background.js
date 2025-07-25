// ARCollector - Simplified Background Script
console.log('[ARCollector] Background script starting...');

const STORAGE_KEY = 'oauth_flows_data';
const attachedTabs = new Set();

// Track processed URLs to prevent duplicates
const processedUrls = new Map(); // URL -> timestamp
const DUPLICATE_THRESHOLD = 5000; // 5 seconds

// Parse URL parameters
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

// Check if URL is authorization request
function isAuthorizationRequest(url, params) {
  return !!(params.client_id);
}

// Check if URL is authorization response
function isAuthorizationResponse(url, params) {
  const hasSuccessParams = params.code || params.access_token || params.id_token;
  const hasErrorParams = params.error;
  const hasState = params.state;
  
  return (hasSuccessParams || hasErrorParams) && hasState;
}

// Check if URL was recently processed (prevent duplicates)
function wasRecentlyProcessed(url) {
  const now = Date.now();
  const lastProcessed = processedUrls.get(url);
  
  if (lastProcessed && (now - lastProcessed) < DUPLICATE_THRESHOLD) {
    return true;
  }
  
  // Clean old entries
  for (const [processedUrl, timestamp] of processedUrls.entries()) {
    if (now - timestamp > DUPLICATE_THRESHOLD) {
      processedUrls.delete(processedUrl);
    }
  }
  
  processedUrls.set(url, now);
  return false;
}

// Load flows from storage
async function loadFlows() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || {};
  } catch (error) {
    console.error('[ARCollector] Error loading flows:', error);
    return {};
  }
}

// Save flows to storage
async function saveFlows(flows) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: flows });
  } catch (error) {
    console.error('[ARCollector] Error saving flows:', error);
  }
}

// Generate flow ID
function generateFlowId(clientId, redirectUri) {
  if (!clientId || !redirectUri) {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }
  const combined = `${clientId}|${redirectUri}`;
  return btoa(combined).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
}

// Handle authorization request
async function handleAuthorizationRequest(url, params) {
  const flows = await loadFlows();
  const flowId = generateFlowId(params.client_id, params.redirect_uri);
  
  // Use complete URL as unique key - if URL is exactly the same, it's the same request
  if (wasRecentlyProcessed(url)) {
    console.log('[ARCollector] Skipping duplicate authorization request:', url);
    return;
  }

  // Create new flow if different parameters (different URL means different request)
  if (flows[flowId] && flows[flowId].authorization_request) {
    // Different URL = different request, create new flow with timestamp
    const timestampSuffix = Date.now().toString().slice(-4);
    const newFlowId = `${flowId}_${timestampSuffix}`;
    console.log('[ARCollector] Creating new flow for different request:', newFlowId);
    
    flows[newFlowId] = {
      id: newFlowId,
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      created_at: new Date().toISOString(),
      authorization_request: {
        timestamp: new Date().toISOString(),
        url: url,
        parameters: params
      },
      authorization_response: null
    };
    
    await saveFlows(flows);
    console.log('[ARCollector] Authorization request saved with new flow ID:', newFlowId);
    return;
  }

  const authRequest = {
    timestamp: new Date().toISOString(),
    url: url,
    parameters: params
  };

  if (!flows[flowId]) {
    flows[flowId] = {
      id: flowId,
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      created_at: authRequest.timestamp,
      authorization_request: null,
      authorization_response: null
    };
  }

  flows[flowId].authorization_request = authRequest;
  await saveFlows(flows);
  
  console.log('[ARCollector] Authorization request saved:', flowId);
}

// Handle authorization response
async function handleAuthorizationResponse(url, params) {
  if (wasRecentlyProcessed(url)) {
    console.log('[ARCollector] Skipping duplicate authorization response:', url);
    return;
  }

  const flows = await loadFlows();
  
  try {
    const urlObj = new URL(url);
    const redirectUri = urlObj.origin + urlObj.pathname;
    
    console.log('[ARCollector] Looking for flow with redirect_uri:', redirectUri, 'and state:', params.state);
    console.log('[ARCollector] Available flows:', Object.keys(flows));
    
    // Find matching flow by redirect_uri and state
    let matchingFlowId = null;
    for (const [flowId, flow] of Object.entries(flows)) {
      console.log('[ARCollector] Checking flow:', flowId, 'redirect_uri:', flow.redirect_uri, 'state:', flow.authorization_request?.parameters?.state);
      
      if (!flow.authorization_response && 
          flow.redirect_uri === redirectUri &&
          flow.authorization_request?.parameters?.state === params.state) {
        matchingFlowId = flowId;
        break;
      }
    }

    if (matchingFlowId) {
      const responseType = params.error ? 'error' : 'success';
      
      flows[matchingFlowId].authorization_response = {
        timestamp: new Date().toISOString(),
        url: url,
        type: responseType,
        parameters: params
      };
      
      await saveFlows(flows);
      console.log('[ARCollector] ✅ Authorization response linked to flow:', matchingFlowId);
    } else {
      console.log('[ARCollector] ❌ No matching flow found for response:', url);
      console.log('[ARCollector] Expected redirect_uri:', redirectUri, 'Expected state:', params.state);
    }
  } catch (error) {
    console.error('[ARCollector] Error processing authorization response:', error);
  }
}

// Debugger event handler
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (method === 'Network.requestWillBeSent') {
    const url = params.request.url;
    const urlParams = parseUrlParameters(url);
    
    if (isAuthorizationRequest(url, urlParams)) {
      console.log('[ARCollector] 🎯 AUTHORIZATION REQUEST DETECTED:', url);
      await handleAuthorizationRequest(url, urlParams);
    } else if (isAuthorizationResponse(url, urlParams)) {
      console.log('[ARCollector] 🎯 AUTHORIZATION RESPONSE DETECTED:', url);
      await handleAuthorizationResponse(url, urlParams);
    }
  }
});

// Auto-attach debugger to active tabs
async function attachToActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const tab of tabs) {
      if (!attachedTabs.has(tab.id) && tab.url && !tab.url.startsWith('chrome://')) {
        try {
          await chrome.debugger.attach({ tabId: tab.id }, '1.3');
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable');
          attachedTabs.add(tab.id);
          console.log('[ARCollector] Debugger attached to tab:', tab.id);
        } catch (error) {
          console.log('[ARCollector] Cannot attach to tab:', tab.id, error.message);
        }
      }
    }
  } catch (error) {
    console.error('[ARCollector] Auto-attach error:', error);
  }
}

// Extension lifecycle
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ARCollector] Extension installed');
  setTimeout(attachToActiveTab, 1000);
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[ARCollector] Extension startup');
  setTimeout(attachToActiveTab, 1000);
});

// Tab events
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await attachToActiveTab();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
});

// WebNavigation API for catching authorization responses
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // Only main frame
  
  const url = details.url;
  const params = parseUrlParameters(url);
  
  if (isAuthorizationResponse(url, params)) {
    console.log('[ARCollector] 🎯 AUTHORIZATION RESPONSE DETECTED (webNavigation):', url);
    await handleAuthorizationResponse(url, params);
  }
});

// Debugger detach handler
chrome.debugger.onDetach.addListener((source, reason) => {
  attachedTabs.delete(source.tabId);
  console.log('[ARCollector] Debugger detached:', source.tabId, reason);
});

// Message handler
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === 'toggleDebugger') {
    const tabId = request.tabId;
    
    try {
      if (attachedTabs.has(tabId)) {
        await chrome.debugger.detach({ tabId: tabId });
        attachedTabs.delete(tabId);
        sendResponse({ status: 'detached' });
      } else {
        await chrome.debugger.attach({ tabId: tabId }, '1.3');
        await chrome.debugger.sendCommand({ tabId: tabId }, 'Network.enable');
        attachedTabs.add(tabId);
        sendResponse({ status: 'attached' });
      }
    } catch (error) {
      sendResponse({ status: 'error', error: error.message });
    }
  } else if (request.action === 'authorizationResponse') {
    console.log('[ARCollector] Received auth response from content script:', request.url);
    
    try {
      await handleAuthorizationResponse(request.url, request.parameters);
      sendResponse({ status: 'processed' });
    } catch (error) {
      console.error('[ARCollector] Error processing auth response:', error);
      sendResponse({ status: 'error', error: error.message });
    }
  }
  
  return true; // Keep message channel open for async response
});

console.log('[ARCollector] Background script loaded successfully');