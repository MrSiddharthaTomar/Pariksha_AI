import { Request, Response } from 'express';
import { loadFaceModels } from '../utils/faceRecognition';

export const loadModels = async (req: Request, res: Response) => {
  try {
    await loadFaceModels();
    res.status(200).json({ message: 'Face recognition models loaded successfully' });
  } catch (error: any) {
    console.error('Load models error:', error);
    res.status(500).json({ message: 'Failed to load models', error: error.message });
  }
};

export const aiGenerateTest = async (req: Request, res: Response) => {
  const { aiPrompt } = req.body;

  if (!aiPrompt || aiPrompt.trim().length === 0) {
    return res.status(400).json({ message: 'AI prompt is required' });
  }

  let questions: any[] = [];
  let aiProvider = 'mock';
  let errorMessage = '';

  // Try Gemini first
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('Testing Gemini API...');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Generate 5 multiple choice test questions based on: ${aiPrompt}. Return ONLY a JSON array format: [{"question": "text", "options": ["opt1", "opt2", "opt3", "opt4"], "correctAnswer": 0}]`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1500,
            topP: 0.95
          }
        })
      });

      const responseText = await response.text();
      console.log('Gemini response status:', response.status);

      if (response.ok) {
        const data = JSON.parse(responseText || '{}');
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        console.log('Gemini content extracted:', content.substring(0, 200));

        if (content) {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              questions = parsed.map((q: any, idx: number) => ({
                id: idx + 1,
                question: q.question || '',
                options: q.options || ['', '', '', ''],
                correctAnswer: q.correctAnswer || 0
              }));
              aiProvider = 'gemini';
              console.log('Successfully parsed Gemini questions:', questions.length);
            }
          } else {
            console.warn('Gemini response could not be parsed as JSON array:', content);
            errorMessage = 'Gemini response format invalid';
          }
        } else {
          console.warn('Gemini response returned no text content:', data);
          errorMessage = 'Gemini returned empty response';
        }
      } else {
        const errorData = JSON.parse(responseText || '{}');
        console.error('Gemini non-ok response:', response.status, errorData);
        errorMessage = `Gemini API: ${errorData.error?.message || 'Unknown error'}`;
      }
    } catch (error: any) {
      console.error('Gemini API error:', error);
      errorMessage = `Gemini API error: ${error.message}`;
    }
  } else {
    console.log('Gemini API key not configured');
    errorMessage = 'Gemini API key not configured';
  }

  // Try OpenAI as fallback
  if (questions.length === 0 && process.env.OPENAI_API_KEY) {
    try {
      console.log('Trying OpenAI API as fallback...');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: `Generate 5 multiple choice test questions based on: ${aiPrompt}. Return ONLY a JSON array in this exact format: [{"question": "text", "options": ["opt1", "opt2", "opt3", "opt4"], "correctAnswer": 0}]`
            }
          ],
          temperature: 0.7,
          max_tokens: 1500
        })
      });

      const responseText = await response.text();
      console.log('OpenAI response status:', response.status);

      if (response.ok) {
        const data = JSON.parse(responseText || '{}');
        const content = data.choices?.[0]?.message?.content || '';
        console.log('OpenAI content extracted:', content.substring(0, 200));

        if (content) {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              questions = parsed.map((q: any, idx: number) => ({
                id: idx + 1,
                question: q.question || '',
                options: q.options || ['', '', '', ''],
                correctAnswer: q.correctAnswer || 0
              }));
              aiProvider = 'openai';
              console.log('Successfully parsed OpenAI questions:', questions.length);
            }
          } else {
            console.warn('OpenAI response could not be parsed as JSON array:', content);
          }
        }
      } else {
        const errorData = JSON.parse(responseText || '{}');
        console.error('OpenAI non-ok response:', response.status, errorData);
      }
    } catch (error: any) {
      console.error('OpenAI API error:', error);
    }
  }

  // If still no questions, return error instead of mock questions
  if (questions.length === 0) {
    console.log('AI question generation failed:', errorMessage);
    return res.status(500).json({
      message: 'Unable to generate questions at this time. Please try again later.',
      error: errorMessage || 'All AI providers failed to generate questions'
    });
  }

  res.status(200).json({
    questions,
    aiProvider,
    errorMessage: errorMessage || undefined
  });
};