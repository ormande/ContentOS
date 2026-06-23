export const assistantGateway = {
  isEnabled(state) {
    return Boolean(state.ai?.enabled);
  },

  async suggestNextSteps() {
    return {
      status: "disabled",
      suggestions: []
    };
  },

  async improveCaption() {
    return {
      status: "disabled",
      caption: null
    };
  },

  async auditWorkspace() {
    return {
      status: "disabled",
      findings: []
    };
  }
};
