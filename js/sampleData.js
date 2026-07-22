/**
 * Data fetcher and sample data provider
 */

const SampleData = {
  /**
   * Load dataset from file path via fetch
   */
  async fetchDefaultData() {
    try {
      const response = await fetch('./Travinh - HS_L0002_2026-03-06-sang.txt');
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim().length > 0) {
          return text;
        }
      }
    } catch (err) {
      console.warn("Could not fetch file directly, using fallback loader", err);
    }
    return null;
  }
};

window.SampleData = SampleData;
