export type Program = {
  program: WebGLProgram
  uniforms: Map<string, WebGLUniformLocation | null>
  attribs: Map<string, number>
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return sh
}

export function createProgram(gl: WebGL2RenderingContext, vert: string, frag: string): Program {
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vert))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`)
  }
  return { program, uniforms: new Map(), attribs: new Map() }
}

export function uniform(gl: WebGL2RenderingContext, p: Program, name: string): WebGLUniformLocation | null {
  if (!p.uniforms.has(name)) p.uniforms.set(name, gl.getUniformLocation(p.program, name))
  return p.uniforms.get(name)!
}

export function attrib(gl: WebGL2RenderingContext, p: Program, name: string): number {
  if (!p.attribs.has(name)) p.attribs.set(name, gl.getAttribLocation(p.program, name))
  return p.attribs.get(name)!
}

export function webgl2Available(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}
