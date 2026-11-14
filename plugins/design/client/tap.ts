/** A tap on the picture drawn with resizeMode "contain", as 0..1 of the picture; null outside it. */
export function tapToPicture(
  tap: { x: number; y: number },
  frame: { width: number; height: number },
  picture: { width: number; height: number },
): { x: number; y: number } | null {
  if (frame.width <= 0 || frame.height <= 0 || picture.width <= 0 || picture.height <= 0) {
    return null;
  }
  const scale = Math.min(frame.width / picture.width, frame.height / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  const left = (frame.width - width) / 2;
  const top = (frame.height - height) / 2;
  const x = (tap.x - left) / width;
  const y = (tap.y - top) / height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** A box given as 0..1 of the picture, in the frame's pixels; null before both are measured. */
export function pictureToFrame(
  box: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
  picture: { width: number; height: number },
): { left: number; top: number; width: number; height: number } | null {
  if (frame.width <= 0 || frame.height <= 0 || picture.width <= 0 || picture.height <= 0) {
    return null;
  }
  const scale = Math.min(frame.width / picture.width, frame.height / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  return {
    left: (frame.width - width) / 2 + box.x * width,
    top: (frame.height - height) / 2 + box.y * height,
    width: box.width * width,
    height: box.height * height,
  };
}
