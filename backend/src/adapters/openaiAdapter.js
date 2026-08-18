'use strict';

function normalizeRequest(body, endpoint) {
  const messages = (body.messages || []).map(m => ({
    role: m.role || 'user',
    content: m.content || ''
  }));

  // Detect capabilities
  const stream = !!body.stream;
  const hasTools = !!(body.tools || body.functions);
  
  let isMultimodal = false;
  let isAudio = false;
  messages.forEach(m => {
    if (typeof m.content !== 'string') {
      isMultimodal = true;
    }
  });

  return {
    model: body.model || 'gpt-4o',
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
  const body = {
    model: model || internalRequest.model || 'gpt-4o',
    messages: internalRequest.messages
  };

  if (internalRequest.temperature !== undefined) {
    body.temperature = internalRequest.temperature;
  }
  if (internalRequest.maxTokens !== undefined) {
    body.max_tokens = internalRequest.maxTokens;
  }

  return body;
}

function normalizeResponse(responseBody, model) {
  const choice = (responseBody.choices && responseBody.choices[0]) || {};
  const text = (choice.message && choice.message.content) || '';
  const role = (choice.message && choice.message.role) || 'assistant';
  const usage = responseBody.usage || {};

  return {
    id: responseBody.id || `msg_${Math.random().toString(36).substr(2, 9)}`,
    text,
    role,
    model: responseBody.model || model || 'gpt-4o',
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0
    }
  };
}

function toClientResponse(internalResponse) {
  return {
    id: internalResponse.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: internalResponse.model,
    choices: [{
      index: 0,
      message: {
        role: internalResponse.role,
        content: internalResponse.text
      },
      finish_reason: 'stop'
    }],
    usage: {
      prompt_tokens: internalResponse.usage.promptTokens,
      completion_tokens: internalResponse.usage.completionTokens,
      total_tokens: internalResponse.usage.totalTokens
    }
  };
}

module.exports = {
  normalizeRequest,
  toProviderRequest,
  normalizeResponse,
  toClientResponse
};
