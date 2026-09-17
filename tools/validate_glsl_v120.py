#!/usr/bin/env python3
from __future__ import annotations
import ctypes, os, re, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ENGINE=ROOT/'engine'
os.environ.setdefault('EGL_PLATFORM','surfaceless')

EGL=ctypes.CDLL('libEGL.so.1')
GL=ctypes.CDLL('libGL.so.1')
EGLDisplay=EGLConfig=EGLContext=EGLSurface=ctypes.c_void_p
EGLint=ctypes.c_int; EGLBoolean=ctypes.c_uint
EGL.eglGetDisplay.argtypes=[ctypes.c_void_p];EGL.eglGetDisplay.restype=EGLDisplay
EGL.eglInitialize.argtypes=[EGLDisplay,ctypes.POINTER(EGLint),ctypes.POINTER(EGLint)];EGL.eglInitialize.restype=EGLBoolean
EGL.eglChooseConfig.argtypes=[EGLDisplay,ctypes.POINTER(EGLint),ctypes.POINTER(EGLConfig),EGLint,ctypes.POINTER(EGLint)];EGL.eglChooseConfig.restype=EGLBoolean
EGL.eglBindAPI.argtypes=[EGLint];EGL.eglBindAPI.restype=EGLBoolean
EGL.eglCreateContext.argtypes=[EGLDisplay,EGLConfig,EGLContext,ctypes.POINTER(EGLint)];EGL.eglCreateContext.restype=EGLContext
EGL.eglCreatePbufferSurface.argtypes=[EGLDisplay,EGLConfig,ctypes.POINTER(EGLint)];EGL.eglCreatePbufferSurface.restype=EGLSurface
EGL.eglMakeCurrent.argtypes=[EGLDisplay,EGLSurface,EGLSurface,EGLContext];EGL.eglMakeCurrent.restype=EGLBoolean
EGL.eglDestroySurface.argtypes=[EGLDisplay,EGLSurface];EGL.eglDestroyContext.argtypes=[EGLDisplay,EGLContext];EGL.eglTerminate.argtypes=[EGLDisplay]

EGL_NONE=0x3038;EGL_SURFACE_TYPE=0x3033;EGL_PBUFFER_BIT=1;EGL_RED_SIZE=0x3024;EGL_GREEN_SIZE=0x3023;EGL_BLUE_SIZE=0x3022;EGL_ALPHA_SIZE=0x3021;EGL_RENDERABLE_TYPE=0x3040;EGL_OPENGL_ES3_BIT=0x40;EGL_CONTEXT_CLIENT_VERSION=0x3098;EGL_OPENGL_ES_API=0x30A0;EGL_WIDTH=0x3057;EGL_HEIGHT=0x3056

def context():
    d=EGL.eglGetDisplay(ctypes.c_void_p(0));maj=EGLint();mi=EGLint()
    if not EGL.eglInitialize(d,ctypes.byref(maj),ctypes.byref(mi)):raise RuntimeError('eglInitialize failed')
    attrs=(EGLint*13)(EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES3_BIT,EGL_RED_SIZE,8,EGL_GREEN_SIZE,8,EGL_BLUE_SIZE,8,EGL_ALPHA_SIZE,8,EGL_NONE)
    cfg=EGLConfig();n=EGLint()
    if not EGL.eglChooseConfig(d,attrs,ctypes.byref(cfg),1,ctypes.byref(n)) or n.value<1:raise RuntimeError('eglChooseConfig failed')
    if not EGL.eglBindAPI(EGL_OPENGL_ES_API):raise RuntimeError('eglBindAPI failed')
    ca=(EGLint*3)(EGL_CONTEXT_CLIENT_VERSION,3,EGL_NONE);c=EGL.eglCreateContext(d,cfg,EGLContext(0),ca)
    sa=(EGLint*5)(EGL_WIDTH,32,EGL_HEIGHT,32,EGL_NONE);s=EGL.eglCreatePbufferSurface(d,cfg,sa)
    if not c or not s or not EGL.eglMakeCurrent(d,s,s,c):raise RuntimeError('EGL ES3 context creation failed')
    return d,c,s

GLuint=ctypes.c_uint;GLenum=ctypes.c_uint;GLint=ctypes.c_int;GLsizei=ctypes.c_int;GLchar=ctypes.c_char;GLfloat=ctypes.c_float
GL.glGetString.argtypes=[GLenum];GL.glGetString.restype=ctypes.c_char_p
GL.glCreateShader.argtypes=[GLenum];GL.glCreateShader.restype=GLuint
GL.glShaderSource.argtypes=[GLuint,GLsizei,ctypes.POINTER(ctypes.c_char_p),ctypes.POINTER(GLint)]
GL.glCompileShader.argtypes=[GLuint];GL.glGetShaderiv.argtypes=[GLuint,GLenum,ctypes.POINTER(GLint)]
GL.glGetShaderInfoLog.argtypes=[GLuint,GLsizei,ctypes.POINTER(GLsizei),ctypes.POINTER(GLchar)]
GL.glDeleteShader.argtypes=[GLuint]
GL.glCreateProgram.restype=GLuint;GL.glAttachShader.argtypes=[GLuint,GLuint];GL.glLinkProgram.argtypes=[GLuint];GL.glGetProgramiv.argtypes=[GLuint,GLenum,ctypes.POINTER(GLint)];GL.glGetProgramInfoLog.argtypes=[GLuint,GLsizei,ctypes.POINTER(GLsizei),ctypes.POINTER(GLchar)];GL.glDeleteProgram.argtypes=[GLuint]
GL.glGenTextures.argtypes=[GLsizei,ctypes.POINTER(GLuint)];GL.glBindTexture.argtypes=[GLenum,GLuint];GL.glTexParameteri.argtypes=[GLenum,GLenum,GLint];GL.glTexImage2D.argtypes=[GLenum,GLint,GLint,GLsizei,GLsizei,GLint,GLenum,GLenum,ctypes.c_void_p]
GL.glGenFramebuffers.argtypes=[GLsizei,ctypes.POINTER(GLuint)];GL.glBindFramebuffer.argtypes=[GLenum,GLuint];GL.glFramebufferTexture2D.argtypes=[GLenum,GLenum,GLenum,GLuint,GLint];GL.glDrawBuffers.argtypes=[GLsizei,ctypes.POINTER(GLenum)];GL.glCheckFramebufferStatus.argtypes=[GLenum];GL.glCheckFramebufferStatus.restype=GLenum;GL.glDeleteTextures.argtypes=[GLsizei,ctypes.POINTER(GLuint)];GL.glDeleteFramebuffers.argtypes=[GLsizei,ctypes.POINTER(GLuint)]

GL_VERTEX_SHADER=0x8B31;GL_FRAGMENT_SHADER=0x8B30;GL_COMPILE_STATUS=0x8B81;GL_LINK_STATUS=0x8B82
GL_TEXTURE_2D=0x0DE1;GL_RGBA8=0x8058;GL_RGBA16F=0x881A;GL_RGBA=0x1908;GL_UNSIGNED_BYTE=0x1401;GL_HALF_FLOAT=0x140B;GL_TEXTURE_MIN_FILTER=0x2801;GL_TEXTURE_MAG_FILTER=0x2800;GL_NEAREST=0x2600;GL_FRAMEBUFFER=0x8D40;GL_COLOR_ATTACHMENT0=0x8CE0;GL_FRAMEBUFFER_COMPLETE=0x8CD5

def log_shader(sh):
    n=GLint();GL.glGetShaderiv(sh,0x8B84,ctypes.byref(n));buf=ctypes.create_string_buffer(max(1,n.value));out=GLsizei();GL.glGetShaderInfoLog(sh,len(buf),ctypes.byref(out),buf);return buf.value.decode(errors='replace')
def log_program(p):
    n=GLint();GL.glGetProgramiv(p,0x8B84,ctypes.byref(n));buf=ctypes.create_string_buffer(max(1,n.value));out=GLsizei();GL.glGetProgramInfoLog(p,len(buf),ctypes.byref(out),buf);return buf.value.decode(errors='replace')
def compile_shader(kind,src,label):
    sh=GL.glCreateShader(kind);b=src.encode();c=ctypes.c_char_p(b);GL.glShaderSource(sh,1,ctypes.byref(c),None);GL.glCompileShader(sh);ok=GLint();GL.glGetShaderiv(sh,GL_COMPILE_STATUS,ctypes.byref(ok));
    if not ok.value: raise RuntimeError(f'{label} compile failed:\n{log_shader(sh)}\n---\n{src[:1800]}')
    return sh
def link(vs,fs,label):
    p=GL.glCreateProgram();GL.glAttachShader(p,vs);GL.glAttachShader(p,fs);GL.glLinkProgram(p);ok=GLint();GL.glGetProgramiv(p,GL_LINK_STATUS,ctypes.byref(ok));
    if not ok.value:raise RuntimeError(f'{label} link failed:\n{log_program(p)}')
    GL.glDeleteProgram(p)

def subst(src,fn):
    maps={
      'game.js':{'W.toFixed(1)':'640.0','H.toFixed(1)':'360.0','MAX_CONE_OCCLUSION_RAYS':'65','MAX_OMNI_OCCLUSION_RAYS':'97'},
      'surfacefx.js':{'MAX_RIPPLES':'12','MAX_PUSH_FIELDS':'4'},
      'foliagefx.js':{}
    }
    for k,v in maps[fn].items():src=src.replace('${'+k+'}',v)
    rem=re.findall(r'\$\{([^}]+)\}',src)
    if rem:raise RuntimeError(f'unresolved shader template in {fn}: {rem}')
    return src

def extract_pairs(path):
    txt=path.read_text();srcs=re.findall(r'`(#version 300 es.*?)`',txt,re.S)
    if len(srcs)%2:raise RuntimeError(f'{path.name}: odd shader count {len(srcs)}')
    return [(subst(srcs[i],path.name),subst(srcs[i+1],path.name)) for i in range(0,len(srcs),2)]

def fbo_variant(float_mode):
    tex=(GLuint*3)();GL.glGenTextures(3,tex);specs=[(GL_RGBA8,GL_UNSIGNED_BYTE)]+([(GL_RGBA16F,GL_HALF_FLOAT)]*2 if float_mode else [(GL_RGBA8,GL_UNSIGNED_BYTE)]*2)
    for i,(internal,typ) in enumerate(specs):
        GL.glBindTexture(GL_TEXTURE_2D,tex[i]);GL.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);GL.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);GL.glTexImage2D(GL_TEXTURE_2D,0,internal,32,32,0,GL_RGBA,typ,None)
    f=GLuint();GL.glGenFramebuffers(1,ctypes.byref(f));GL.glBindFramebuffer(GL_FRAMEBUFFER,f)
    for i in range(3):GL.glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0+i,GL_TEXTURE_2D,tex[i],0)
    bufs=(GLenum*3)(GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT0+1,GL_COLOR_ATTACHMENT0+2);GL.glDrawBuffers(3,bufs);st=GL.glCheckFramebufferStatus(GL_FRAMEBUFFER)
    GL.glDeleteFramebuffers(1,ctypes.byref(f));GL.glDeleteTextures(3,tex)
    if st!=GL_FRAMEBUFFER_COMPLETE:raise RuntimeError(f'MRT {"float" if float_mode else "RGBA8 fallback"} framebuffer incomplete: 0x{st:x}')
    return st
def fbo_test():
    fbo_variant(True);fbo_variant(False)

def main():
    d,c,s=context();version=(GL.glGetString(0x1F02)or b'').decode();renderer=(GL.glGetString(0x1F01)or b'').decode();ext=(GL.glGetString(0x1F03)or b'').decode()
    print(f'GL: {version} / {renderer}')
    if 'GL_EXT_color_buffer_float' not in ext:raise RuntimeError('EXT_color_buffer_float unavailable in validator context')
    total=0
    for fn in ['game.js','surfacefx.js','foliagefx.js']:
        pairs=extract_pairs(ENGINE/fn);print(f'{fn}: {len(pairs)} programs')
        for i,(vs_src,fs_src) in enumerate(pairs):
            vs=compile_shader(GL_VERTEX_SHADER,vs_src,f'{fn} program {i} vertex');fs=compile_shader(GL_FRAGMENT_SHADER,fs_src,f'{fn} program {i} fragment');link(vs,fs,f'{fn} program {i}');GL.glDeleteShader(vs);GL.glDeleteShader(fs);total+=1
    fbo_test();print(f'PASS: {total} production GLSL programs compile+link; float MRT and RGBA8 fallback framebuffers complete')
    EGL.eglMakeCurrent(d,EGLSurface(0),EGLSurface(0),EGLContext(0));EGL.eglDestroySurface(d,s);EGL.eglDestroyContext(d,c);EGL.eglTerminate(d)

if __name__=='__main__':main()
