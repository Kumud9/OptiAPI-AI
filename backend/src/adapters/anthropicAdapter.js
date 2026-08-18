'use strict';

function normalizeRequest(body, endpoint) {
  const messages = [];
  
  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }

  if (Array.isArray(body.messages)) {
    body.messages.forEach(m => {
      messages.push({
        role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : (m.content && m.content[0] && m.content[0].text) || ''
      });
    });
  }

  // Detect capabilities
  const stream = !!body.stream;
  const hasTools = !!body.tools;
  const isMultimodal = false;
  const isAudio = false;

  return {
    model: body.model || 'claude-3-5-sonnet-20241022',
    messages,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    stream,
    hasTools,
    isMultimodal,
    isAudio
  };
}

function toProviderRequest(internalRequest, model) {
  const messages = [];
  let systemText = '';

  internalRequest.messages.forEach(m => {
    if (m.role === 'system') {
      systemText = m.content;
    } else {
      messages.push({
        role: m.role,
        content: m.content
      });
    }
  });

  const body = {
    model: model || internalRequest.model || 'claude-3-5-sonnet-20241022',
    messages,
    max_tokens: internalRequest.maxTokens || 1024
  };

  if (systemText) {
    body.system = systemText;
  }
  if (internalRequest.temperature !== undefined) {
    body.temperature = internalRequest.temperature;
  }

  return body;
}

function normalizeResponse(responseBody, model) {
  const text = (responseBody.content && responseBody.content[0] && responseBody.content[0].text) || '';
  const usage = responseBody.usage || {};

  return {
    id: responseBody.id || `msg_${Math.random().toString(36).substr(2, 9)}`,
    text,
    role: responseBody.role || 'assistant',
    model: responseBody.model || model || 'claude-3-5-sonnet-20241022',
    usage: {
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
    }
  };
}

function toClientResponse(internalResponse) {
  return {
    id: internalResponse.id,
    type: 'message',
    role: internalResponse.role,
    content: [{
      type: 'text',
      text: internalResponse.text
    }],
    model: internalResponse.model,
    usage: {
      input_tokens: internalResponse.usage.promptTokens,
      output_tokens: internalResponse.usage.completionTokens
    }
  };
}

module.exports = {
  normalizeRequest,
  toProviderRequest,
  normalizeResponse,
  toClientResponse
};
