/** Detects when a chat message asks for an app, game or tool (English and Portuguese). */
import { normalize } from '../engines/procedural/artEngine.ts';

const VERBS = String.raw`(build|create|make|code|write|generate|develop|design|program|implement|crie|criar|cria|faca|fazer|faz|monte|montar|construa|construir|gere|gerar|desenvolva|desenvolver|programe|programar|escreva|escrever|quero|preciso)`;
const NOUNS = String.raw`(apps?|application|webapp|game|games|tool|calculator|website|web ?page|page|landing|dashboard|widget|todo|to-do|timer|stopwatch|clock|quiz|form|converter|editor|player|chart|pong|snake|tetris|breakout|tic.?tac.?toe|calendar|portfolio|aplicativo|aplicacao|jogo|jogos|ferramenta|calculadora|site|pagina|painel|lista de tarefas|cronometro|relogio|formulario|conversor|grafico|calendario|portfolio|jogo da velha|cobrinha|simulador|simulator|visualizer|visualizador|animation|animacao|canvas)`;
const INTENT = new RegExp(String.raw`\b${VERBS}\b(?:\W+\w+){0,5}?\W+${NOUNS}\b`, 'i');
const EXPLICIT = /\b(html|css|javascript|tailwind)\b.*\b(app|page|pagina|site|jogo|game)\b/i;

export function detectAppIntent(message: string): boolean {
  const text = normalize(message);
  return INTENT.test(text) || EXPLICIT.test(text);
}
