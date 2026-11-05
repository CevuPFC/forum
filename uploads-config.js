// Otpremanje slika i videa preko Cloudinary-ja (besplatan nalog, bez kartice).
// Dok su oba polja prazna, slike se čuvaju u Firebase bazi, a video je moguć samo preko YouTube linka.
// Uputstvo je u README.md ("Slike i video").
export const uploads = {
  cloudName: "",     // Cloudinary > Dashboard > Cloud name
  uploadPreset: "",  // Settings > Upload > Upload presets (Signing mode: Unsigned)
};
