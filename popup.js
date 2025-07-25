// ARCollector - Popup Script
// Displays collected OAuth flows with detailed information

(function() {
  'use strict';

  const STORAGE_KEY = 'oauth_flows_data';
  
  // DOM elements
  let totalFlowsSpan, completeFlowsSpan, partialFlowsSpan, errorFlowsSpan;
  let flowContainer, exportBtn, clearBtn;

  // Initialize popup
  async function init() {
    // Get DOM elements
    totalFlowsSpan = document.getElementById('totalFlows');
    completeFlowsSpan = document.getElementById('completeFlows');
    partialFlowsSpan = document.getElementById('partialFlows');
    errorFlowsSpan = document.getElementById('errorFlows');
    flowContainer = document.getElementById('flowContainer');
    exportBtn = document.getElementById('exportBtn');
    clearBtn = document.getElementById('clearBtn');

    // Set up event listeners
    exportBtn.addEventListener('click', exportFlows);
    clearBtn.addEventListener('click', clearFlows);

    // Add debugger toggle button
    const debuggerBtn = document.createElement('button');
    debuggerBtn.textContent = 'Toggle Network Monitor';
    debuggerBtn.className = 'btn';
    debuggerBtn.addEventListener('click', toggleNetworkMonitor);
    
    const controls = document.querySelector('.controls');
    controls.insertBefore(debuggerBtn, exportBtn);

    // Load and display flows
    await loadAndDisplayFlows();
  }

  // Toggle network monitoring via debugger
  async function toggleNetworkMonitor() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      
      // Send message to background script to toggle debugger
      chrome.runtime.sendMessage({ 
        action: 'toggleDebugger', 
        tabId: tab.id 
      });
    } catch (error) {
      console.error('[ARCollector] Error toggling network monitor:', error);
    }
  }

  // Load flows from storage and display them
  async function loadAndDisplayFlows() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const flows = result[STORAGE_KEY] || {};
      displayFlows(flows);
    } catch (error) {
      console.error('[ARCollector] Error loading flows:', error);
      flowContainer.innerHTML = '<div class="no-flows">Error loading flows</div>';
    }
  }

  // Display flows in the UI
  function displayFlows(flows) {
    const flowEntries = Object.entries(flows);
    
    if (flowEntries.length === 0) {
      flowContainer.innerHTML = `
        <div class="no-flows">
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <div>No OAuth flows captured yet</div>
            <div style="font-size: 12px; color: #adb5bd;">Visit a website with OAuth/OpenID Connect authentication to start collecting flows</div>
          </div>
        </div>
      `;
      updateStats(0, 0, 0, 0);
      return;
    }

    // Sort flows by creation time (newest first)
    flowEntries.sort((a, b) => {
      const aTime = new Date(a[1].created_at).getTime();
      const bTime = new Date(b[1].created_at).getTime();
      return bTime - aTime;
    });

    // Generate HTML for flows
    const flowsHtml = flowEntries.map(([flowId, flow]) => 
      generateFlowHtml(flowId, flow)
    ).join('');

    flowContainer.innerHTML = flowsHtml;

    // Add toggle functionality
    flowContainer.querySelectorAll('.flow-header').forEach(header => {
      header.addEventListener('click', toggleFlowDetails);
    });

    // Add copy button functionality
    flowContainer.querySelectorAll('.copy-btn').forEach(button => {
      button.addEventListener('click', handleCopyClick);
    });

    // Calculate and update statistics
    const stats = calculateStats(flows);
    updateStats(stats.total, stats.complete, stats.partial, stats.error);
  }

  // Generate HTML for a single flow
  function generateFlowHtml(flowId, flow) {
    const hasRequest = flow.authorization_request !== null;
    const hasResponse = flow.authorization_response !== null;
    
    let status, statusClass;
    if (hasRequest && hasResponse) {
      if (flow.authorization_response.type === 'error') {
        status = 'Error';
        statusClass = 'status-error';
      } else {
        status = 'Complete';
        statusClass = 'status-complete';
      }
    } else {
      status = 'Partial';
      statusClass = 'status-partial';
    }

    const timestamp = new Date(flow.created_at).toLocaleString();
    const clientId = flow.client_id || 'Unknown';

    return `
      <div class="flow-item">
        <div class="flow-header" data-flow-id="${flowId}">
          <div class="flow-info">
            <span class="flow-status ${statusClass}">${status}</span>
            <span class="client-id">${escapeHtml(clientId)}</span>
            <span class="timestamp">${timestamp}</span>
          </div>
          <span class="toggle-icon">▶</span>
        </div>
        
        <div class="flow-details" data-flow-id="${flowId}">
          ${generateRequestHtml(flow.authorization_request)}
          ${generateResponseHtml(flow.authorization_response)}
        </div>
      </div>
    `;
  }

  // Generate HTML for authorization request
  function generateRequestHtml(request) {
    if (!request) {
      return `
        <div class="request-response">
          <div class="section-title">
            <span class="missing-icon">❓</span>
            Authorization Request (Missing)
          </div>
        </div>
      `;
    }

    const timestamp = new Date(request.timestamp).toLocaleString();
    const paramsHtml = generateParamsTable(request.parameters, 'request');

    return `
      <div class="request-response">
        <div class="section-header">
          <div class="section-title">
            <span class="request-icon">📤</span>
            Authorization Request
            <span class="timestamp">${timestamp}</span>
          </div>
          <div class="copy-buttons">
            <button class="copy-btn" data-copy-text="${escapeHtml(request.url)}" data-copy-type="url">Copy URL</button>
          </div>
        </div>
        <div class="url-display">${escapeHtml(request.url)}</div>
        ${paramsHtml}
      </div>
    `;
  }

  // Generate HTML for authorization response
  function generateResponseHtml(response) {
    if (!response) {
      return `
        <div class="request-response">
          <div class="section-title">
            <span class="missing-icon">❓</span>
            Authorization Response (Missing)
          </div>
        </div>
      `;
    }

    const timestamp = new Date(response.timestamp).toLocaleString();
    const icon = response.type === 'error' ? '❌' : '✅';
    const iconClass = response.type === 'error' ? 'error-icon' : 'response-icon';
    const typeText = response.type === 'error' ? 'Error Response' : 'Success Response';
    const paramsHtml = generateParamsTable(response.parameters, 'response');

    return `
      <div class="request-response">
        <div class="section-header">
          <div class="section-title">
            <span class="${iconClass}">${icon}</span>
            Authorization ${typeText}
            <span class="timestamp">${timestamp}</span>
          </div>
          <div class="copy-buttons">
            <button class="copy-btn" data-copy-text="${escapeHtml(response.url)}" data-copy-type="url">Copy URL</button>
          </div>
        </div>
        <div class="url-display">${escapeHtml(response.url)}</div>
        ${paramsHtml}
      </div>
    `;
  }

  // Generate HTML table for parameters
  function generateParamsTable(params, type) {
    if (!params || Object.keys(params).length === 0) {
      return '<div style="color: #6c757d; font-style: italic; margin-top: 8px;">No parameters</div>';
    }

    const rows = Object.entries(params).map(([key, value]) => `
      <tr>
        <th>${escapeHtml(key)}</th>
        <td>
          <div class="param-cell-content">
            <span class="param-value">${escapeHtml(value || '')}</span>
            <button class="copy-btn param-copy-btn" data-copy-text="${escapeHtml(value || '')}" data-copy-type="param" data-param-name="${escapeHtml(key)}">Copy</button>
          </div>
        </td>
      </tr>
    `).join('');

    return `
      <table class="params-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  // Toggle flow details visibility
  function toggleFlowDetails(event) {
    const flowId = event.currentTarget.dataset.flowId;
    const details = document.querySelector(`[data-flow-id="${flowId}"].flow-details`);
    const icon = event.currentTarget.querySelector('.toggle-icon');

    if (details.classList.contains('expanded')) {
      details.classList.remove('expanded');
      icon.classList.remove('expanded');
    } else {
      details.classList.add('expanded');
      icon.classList.add('expanded');
    }
  }

  // Calculate statistics
  function calculateStats(flows) {
    const stats = { total: 0, complete: 0, partial: 0, error: 0 };
    
    for (const flow of Object.values(flows)) {
      stats.total++;
      
      const hasRequest = flow.authorization_request !== null;
      const hasResponse = flow.authorization_response !== null;
      
      if (hasRequest && hasResponse) {
        if (flow.authorization_response.type === 'error') {
          stats.error++;
        } else {
          stats.complete++;
        }
      } else {
        stats.partial++;
      }
    }
    
    return stats;
  }

  // Update statistics display
  function updateStats(total, complete, partial, error) {
    totalFlowsSpan.textContent = total;
    completeFlowsSpan.textContent = complete;
    partialFlowsSpan.textContent = partial;
    errorFlowsSpan.textContent = error;
  }

  // Export flows to JSON
  async function exportFlows() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const flows = result[STORAGE_KEY] || {};
      
      const dataStr = JSON.stringify(flows, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `oauth-flows-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('[ARCollector] Flows exported');
    } catch (error) {
      console.error('[ARCollector] Error exporting flows:', error);
      alert('Error exporting flows');
    }
  }

  // Clear all flows
  async function clearFlows() {
    if (!confirm('Are you sure you want to clear all captured OAuth flows? This cannot be undone.')) {
      return;
    }
    
    try {
      await chrome.storage.local.remove(STORAGE_KEY);
      await loadAndDisplayFlows();
      console.log('[ARCollector] All flows cleared');
    } catch (error) {
      console.error('[ARCollector] Error clearing flows:', error);
      alert('Error clearing flows');
    }
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }


  // Handle copy button clicks
  function handleCopyClick(event) {
    const button = event.target;
    const text = button.dataset.copyText;
    const type = button.dataset.copyType;
    const paramName = button.dataset.paramName;
    
    if (!text) {
      console.error('No text to copy');
      return;
    }
    
    copyToClipboard(text, button, paramName);
  }

  // Copy text to clipboard
  async function copyToClipboard(text, button, paramName = null) {
    try {
      await navigator.clipboard.writeText(text);
      
      // Visual feedback
      const originalText = button.textContent;
      const feedbackText = paramName ? `${paramName} copied!` : 'Copied!';
      button.textContent = feedbackText;
      button.style.backgroundColor = '#d4edda';
      button.style.color = '#155724';
      
      setTimeout(() => {
        button.textContent = originalText;
        button.style.backgroundColor = '';
        button.style.color = '';
      }, 1500);
      
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      
      try {
        document.execCommand('copy');
        
        const originalText = button.textContent;
        const feedbackText = paramName ? `${paramName} copied!` : 'Copied!';
        button.textContent = feedbackText;
        button.style.backgroundColor = '#d4edda';
        button.style.color = '#155724';
        
        setTimeout(() => {
          button.textContent = originalText;
          button.style.backgroundColor = '';
          button.style.color = '';
        }, 1500);
        
      } catch (fallbackError) {
        console.error('Fallback copy failed:', fallbackError);
        button.textContent = 'Copy Failed';
        button.style.backgroundColor = '#f8d7da';
        button.style.color = '#721c24';
        
        setTimeout(() => {
          button.textContent = 'Copy';
          button.style.backgroundColor = '';
          button.style.color = '';
        }, 1500);
      }
      
      document.body.removeChild(textArea);
    }
  };

  // Initialize when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();