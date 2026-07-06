import { GoogleGenAI } from "@google/genai";

// Initialize the client with Vite's environment variable
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

export const convertHtmlToSvg = async (htmlInput: string, optimize: boolean = false): Promise<string> => {
  try {
    const optimizationInstructions = optimize
      ? `
      8. OPTIMIZE for strict file size and performance:
         - Limit all coordinates/dimensions to maximum 1 decimal place.
         - Use shorthand hex codes (#f00) where possible.
         - Remove ALL unnecessary attributes, IDs, classes, and metadata.
         - Combine paths where possible to reduce node count.
         - Do not include any comments.
         - Minify the XML structure (remove unnecessary whitespace).`
      : '';

    const prompt = `
      You are an expert Frontend Engineer and SVG Graphics Specialist.
      
      Task: Convert the provided HTML/CSS snippet into a strictly valid, standalone SVG string.
      
      Input HTML/CSS:
      ${htmlInput}
      
      Requirements:
      1. The output MUST be raw SVG code.
      2. Do NOT wrap the code in Markdown code blocks (no \`\`\`xml or \`\`\`svg).
      3. Do NOT include any explanations or conversational text.
      4. Ensure the SVG has a 'xmlns="http://www.w3.org/2000/svg"' attribute.
      5. Translate CSS styles (gradients, shadows, border-radius, flex layouts) into their SVG equivalents (defs, filter, rect with rx, manual positioning) as accurately as possible.
      6. If the HTML implies specific dimensions, use them in the viewBox. If not, default to a standard 1024x1024 or appropriate aspect ratio.
      7. The resulting SVG should look visually identical to how the HTML would render in a browser.
      ${optimizationInstructions}
      
      Return ONLY the SVG string.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.2, // Low temperature for deterministic code generation
      }
    });

    const text = response.text;

    if (!text) {
      throw new Error("No response received from Gemini.");
    }

    // Clean up if the model accidentally wrapped it in markdown
    let cleanedSvg = text.trim();
    if (cleanedSvg.startsWith('```')) {
      cleanedSvg = cleanedSvg.replace(/^```(xml|svg)?/i, '').replace(/```$/, '');
    }

    return cleanedSvg.trim();

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to convert HTML to SVG. Please try again.");
  }
};