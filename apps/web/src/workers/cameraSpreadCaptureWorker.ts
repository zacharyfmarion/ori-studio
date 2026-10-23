import { expose } from 'comlink';
import { createCameraSpreadCaptureSession } from '../diagram/capture/cameraSpreadCapture';
// Separate from live rendering: a settled vector export cannot stall orbit.
expose(createCameraSpreadCaptureSession());
