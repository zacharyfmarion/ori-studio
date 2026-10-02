import { describe, expect, it } from 'vitest';
import {
  DECODABLE_IMAGE_ACCEPT,
  DECODABLE_IMAGE_EXTENSIONS,
  isDecodableImageType,
  isSvgImage,
} from './imageFormats';
import { OPENABLE_FILE_EXTENSIONS } from './fileDrop';

describe('isDecodableImageType', () => {
  it('accepts the formats a browser draws', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']) {
      expect(isDecodableImageType(type)).toBe(true);
    }
  });

  // The bug this exists for: macOS maps `.ori` to the UTI `com.olympus.raw-image`,
  // so a browser reports this type for an Oriedita crease pattern. No engine
  // decodes camera raw, so anything that treats it as an image can only throw.
  it('rejects camera-raw types, which no engine decodes', () => {
    for (const type of [
      'image/x-olympus-orf',
      'image/x-canon-cr2',
      'image/x-nikon-nef',
      'image/x-sony-arw',
      'image/x-adobe-dng',
    ]) {
      expect(isDecodableImageType(type)).toBe(false);
    }
  });

  it('rejects non-images and the empty type a document arrives with', () => {
    expect(isDecodableImageType('')).toBe(false);
    expect(isDecodableImageType('application/octet-stream')).toBe(false);
    expect(isDecodableImageType('text/x-c++src')).toBe(false);
  });

  it('is not a prefix test', () => {
    expect(isDecodableImageType('image/')).toBe(false);
    expect(isDecodableImageType('image/png-ish')).toBe(false);
  });

  it('normalizes case and MIME parameters', () => {
    expect(isDecodableImageType('IMAGE/PNG')).toBe(true);
    expect(isDecodableImageType('image/svg+xml; charset=utf-8')).toBe(true);
    expect(isDecodableImageType(' image/jpeg ')).toBe(true);
  });
});

describe('isSvgImage', () => {
  it('recognizes the SVG type, with or without parameters', () => {
    expect(isSvgImage('image/svg+xml', 'drawing')).toBe(true);
    expect(isSvgImage('Image/SVG+XML; charset=utf-8', 'drawing')).toBe(true);
  });

  // The picker passes on whatever `accept` let through, so a platform that
  // types `.svg` as nothing must still reach the SVG path.
  it('recognizes the extension when the type is missing', () => {
    expect(isSvgImage('', 'crease pattern.svg')).toBe(true);
    expect(isSvgImage('', 'PATTERN.SVG')).toBe(true);
  });

  it('leaves raster images and look-alike names alone', () => {
    expect(isSvgImage('image/png', 'diagram.png')).toBe(false);
    expect(isSvgImage('', 'diagram.svgz')).toBe(false);
    expect(isSvgImage('', 'svg')).toBe(false);
  });

  // The bitmap decoder sniffs content and reads a misnamed PNG; the SVG parser
  // could only reject it.
  it('lets a type naming another image format win over the name', () => {
    expect(isSvgImage('image/png', 'diagram.svg')).toBe(false);
    expect(isSvgImage('image/jpeg', 'photo.SVG')).toBe(false);
    expect(isSvgImage('application/octet-stream', 'diagram.svg')).toBe(true);
  });
});

describe('DECODABLE_IMAGE_EXTENSIONS', () => {
  it('never offers an extension the app opens as a document', () => {
    // An `accept` list that names `.ori` would put a crease pattern back in the
    // image picker, which is the same misroute by another door.
    const openable = new Set<string>(OPENABLE_FILE_EXTENSIONS);
    for (const extension of DECODABLE_IMAGE_EXTENSIONS) {
      expect(openable.has(extension)).toBe(false);
    }
  });

  it('renders an accept list of dotted extensions', () => {
    expect(DECODABLE_IMAGE_ACCEPT.split(',')).toEqual(
      DECODABLE_IMAGE_EXTENSIONS.map((extension) => `.${extension}`)
    );
    expect(DECODABLE_IMAGE_ACCEPT).toContain('.png');
    expect(DECODABLE_IMAGE_ACCEPT).not.toContain('.ori');
  });
});
