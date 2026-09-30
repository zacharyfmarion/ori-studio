import { createContext } from 'react';

/**
 * What `useIsPhoneLayout` and `useIsPhoneSurface` answer when there is no browser to ask.
 *
 * Only the prerender provides it: it writes the landing page twice, once as a desktop and
 * once as a phone (inside a `<template>`), so its inline scripts can show whichever one this
 * visitor's live page will render (`seo/staticPaint.ts`). In the app it is never provided,
 * and a browser never reads a server snapshot anyway.
 */
export const ServerPhoneSurface = createContext(false);
