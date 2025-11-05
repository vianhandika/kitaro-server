export function parseEnvValue(str: string): string[] {
    let cleaned = str.trim();
    
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
    }
    
    return cleaned
        .split(/[,;]/u)
        .map(x => x.trim())
        .filter(x => x.length > 0);
}
