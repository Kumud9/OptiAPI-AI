'use strict';

function normalizeRequest(body, endpoint) {
  const messages = [];
  let systemInstruction = '';

  // Extract from contents
  if (Array.isArray(body.contents)) {
    body.contents.forEach(item => {
      const role = item.role === 'model' ? 'assistant' : 'user';
      const text = (item.parts && item.parts[0] && item.parts[0].text) || '';
      messages.push({ role, content: text });
    });
  }

  if (body.systemInstruction && body.systemInstruction.parts && body.systemInstruction.parts[0]) {
    systemInstruction = body.systemInstruction.parts[0].text || '';
    if (systemInstruction) {
      messages.unshift({ role: 'system', content: systemInstruction });
    }
  }

  // Detect capabilities
  const hasTools = !!body.tools;
  const isMultimodal = false; // Phase 2 simple text only
  const isAudio = false;

  return {
    model: body.model || 'gemini-1.5-flash',
    messages,
    temperature: (body.generationConfig && body.generationConfig.temperature),
    maxTokens: (body.generationConfig && body.generationConfig.maxOutputTokens),
    stream: false,
    hasTools,
    isMultimodal,
    isAudio
  };
}

function toProviderRequest(internalRequest, model) {
  const contents = [];
  let systemInstructionText = '';

  internalRequest.messages.forEach(m => {
    if (m.role === 'system') {
      systemInstructionText = m.content;
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    }
  });

  const body = {
    contents
  };

  if (systemInstructionText) {
    body.systemInstruction = {
      parts: [{ text: systemInstructionText }]
    };
  }

  const generationConfig = {};
  if (internalRequest.temperature !== undefined) {
    generationConfig.temperature = internalRequest.temperature;
  }
  if (internalRequest.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = internalRequest.maxTokens;
  }

  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  return body;
}

function normalizeResponse(responseBody, model) {
  const candidate = (responseBody.candidates && responseBody.candidates[0]) || {};
  const text = (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) || '';
  const usage = responseBody.usageMetadata || {};

  return {
    id: responseBody.id || `msg_${Math.random().toString(36).substr(2, 9)}`,
    text,
    role: 'assistant',
    model: responseBody.modelVersion || model || 'gemini-1.5-flash',
    usage: {
      promptTokens: usage.promptTokenCount || 0,
      completionTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0
    }
  };
}

function toClientResponse(internalResponse) {
  return {
    candidates: [{
      content: {
        parts: [{ text: internalResponse.text }],
        role: 'model'
      },
      finishReason: 'STOP',
      index: 0
    }],
    usageMetadata: {
      promptTokenCount: internalResponse.usage.promptTokens,
      candidatesTokenCount: internalResponse.usage.completionTokens,
      totalTokenCount: internalResponse.usage.totalTokens
    },
    modelVersion: internalResponse.model
  };
}

module.exports = {
  normalizeRequest,
  toProviderRequest,
  normalizeResponse,
  toClientResponse
};
