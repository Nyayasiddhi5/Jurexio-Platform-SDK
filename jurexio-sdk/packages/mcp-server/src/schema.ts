/**
 * JSON Schema helpers for MCP tool descriptors.
 */

export function registrySchemaToJsonSchema(inputSchema: Record<string, string>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, typeSpec] of Object.entries(inputSchema)) {
    const optional = typeSpec.endsWith('?');
    const isArray = typeSpec.includes('[]');
    const base = typeSpec.replace('?', '').replace('[]', '');

    let jsonType: string = 'string';
    if (base === 'number') jsonType = 'number';
    else if (base === 'boolean') jsonType = 'boolean';
    else if (base === 'object') jsonType = 'object';
    else if (isArray) jsonType = 'array';

    const prop: Record<string, unknown> = { type: jsonType, description: typeSpec };
    if (isArray && base !== 'object') {
      prop.items = { type: base === 'number' ? 'number' : 'string' };
    }
    properties[key] = prop;
    if (!optional) required.push(key);
  }

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
  };
}

export function objectSchema(
  properties: Record<string, unknown>,
  required?: string[],
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    ...(required?.length ? { required } : {}),
  };
}
