import { describe, expect, it } from 'vitest';
import {
  DECODABLE_IMAGE_ACCEPT,
  DECODABLE_IMAGE_EXTENSIONS,
  isDecodableImageType,
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
      DECODABLE_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
    );
    expect(DECODABLE_IMAGE_ACCEPT).toContain('.png');
    expect(DECODABLE_IMAGE_ACCEPT).not.toContain('.ori');
  });
});
