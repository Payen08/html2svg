import { GoogleGenAI } from "@google/genai";

// Initialize the client with Vite's environment variable
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

export type CssFramework = 'vanilla' | 'tailwind';

export const convertSvgToHtml = async (
    svgInput: string,
    framework: CssFramework = 'vanilla'
): Promise<{ html: string; css: string }> => {
    try {
        const frameworkInstructions = framework === 'tailwind'
            ? `
      Use Tailwind CSS classes for styling. Include the Tailwind CDN in the HTML.
      Use modern Tailwind patterns like flex, grid, rounded, shadow, bg-gradient-to-*, etc.
      Do NOT generate a separate CSS block - all styles should be Tailwind classes.`
            : `
      Generate clean, semantic CSS with:
      - CSS variables for colors
      - Flexbox/Grid for layout
      - Modern CSS features (border-radius, box-shadow, linear-gradient)
      - BEM-like naming conventions for classes`;

        const prompt = `
      You are an expert Frontend Engineer specializing in converting visual designs to code.
      
      Task: Convert the provided SVG design mockup into semantic HTML and CSS code.
      
      Input SVG:
      ${svgInput}
      
      Requirements:
      1. Analyze the SVG to understand:
         - Layout structure (containers, sections, rows, columns)
         - Typography (headings, paragraphs, labels)
         - Colors and gradients
         - Shapes and their semantic meaning (buttons, cards, inputs)
         - Visual hierarchy
      
      2. Generate semantic HTML:
         - Use appropriate HTML5 elements (header, main, section, article, button, etc.)
         - Add meaningful class names
         - Structure content logically
         - Include alt text where appropriate
      
      3. ${frameworkInstructions}
      
      4. The generated code should:
         - Be responsive-ready
         - Look visually identical to the SVG when rendered
         - Use modern best practices
         - Be production-ready quality
      
      5. Output format - respond with ONLY a JSON object (no markdown):
         {
           "html": "<!DOCTYPE html>...",
           "css": "/* CSS code here */"
         }
      
      The HTML should be a complete document with proper structure.
      ${framework === 'tailwind' ? 'The css field should be an empty string for Tailwind.' : ''}
    `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-05-20',
            contents: prompt,
            config: {
                temperature: 0.3,
            }
        });

        const text = response.text;

        if (!text) {
            throw new Error("No response received from Gemini.");
        }

        // Clean up if the model accidentally wrapped it in markdown
        let cleanedText = text.trim();
        if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
        }

        try {
            const result = JSON.parse(cleanedText);
            return {
                html: result.html || '',
                css: result.css || ''
            };
        } catch (parseError) {
            // If JSON parsing fails, try to extract HTML from the response
            console.error("Failed to parse JSON response, attempting to extract HTML:", parseError);
            return {
                html: cleanedText,
                css: ''
            };
        }

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("Failed to convert SVG to HTML. Please try again.");
    }
};
