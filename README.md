# Sixth Street Logo - 3D OBJ Viewer & Editor

An interactive web-based 3D model viewer and editor built with Vue 3 and Three.js. Upload OBJ files and manipulate them with intuitive drag-and-rotate controls, adjust scale, and export screenshots.

## Features

- 👁️ **Interactive 3D Viewer** - Render and view OBJ files with smooth interactions
- 🖱️ **Drag & Rotate** - Click and drag to rotate the model in real-time
- 📏 **Transform Controls** - Adjust rotation and scale using sliders
- 📸 **Screenshot Export** - Download rendered view as PNG
- 🎨 **Professional UI** - Clean, intuitive interface for designers
- 📱 **Responsive Design** - Works on desktop and tablet devices
- 🚀 **GitHub Pages Ready** - Deploy directly to GitHub Pages

## Getting Started

### Prerequisites

- Node.js 16+ and npm

### Installation

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

Then open your browser and navigate to `http://localhost:5173/`.

### Building for Production

Build the project for deployment:

```bash
npm run build
```

The output will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## GitHub Pages Deployment

### Step 1: Create a GitHub Repository

1. Create a new public repository on GitHub
2. Clone it to your local machine
3. Copy this project's files into the repository

### Step 2: Update Configuration

If your repository is not named `username.github.io`, update the `base` path in `vite.config.js`:

```javascript
export default defineConfig({
  // ...
  base: '/repository-name/', // Change to your repo name
})
```

### Step 3: Build and Deploy

1. Build the project:
   ```bash
   npm run build
   ```

2. Commit and push the `dist/` folder to your repository:
   ```bash
   git add dist/
   git commit -m "Deploy to GitHub Pages"
   git push origin main
   ```

3. In your GitHub repository settings:
   - Go to **Settings** → **Pages**
   - Under "Build and deployment", select:
     - Source: **Deploy from a branch**
     - Branch: **main** (or your default branch)
     - Folder: **/ (root)** or **/dist** (depending on your setup)

Alternatively, use **GitHub Actions** to automate deployment (recommended).

### Step 3 (Alternative): Using GitHub Actions

Create a `.github/workflows/deploy.yml` file:

```yaml
name: Build and Deploy

on:
  push:
    branches:
      - main

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Build
        run: npm run build
      
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## Usage

1. **Load an OBJ File**
   - Click on "File Upload" and select your OBJ file
   - The model will be loaded and centered in the viewer

2. **Rotate the Model**
   - Click and drag on the 3D canvas to rotate
   - Use the rotation sliders for precise control

3. **Adjust Scale**
   - Use the Scale slider to zoom in/out

4. **Reset View**
   - Click "Reset View" to return to default position and scale

5. **Export Screenshot**
   - Click "Download Screenshot" to save a PNG of the current view

## Project Structure

```
src/
├── components/
│   ├── ThreeViewer.vue      # Main 3D viewer component
│   └── HelloWorld.vue         # Can be removed
├── App.vue                    # Root component
├── main.js                    # Application entry point
└── style.css                  # Global styles
```

## Technologies

- **Vue 3** - Progressive JavaScript framework
- **Vite** - Next generation frontend tooling
- **Three.js** - 3D JavaScript library
- **OBJLoader** - Three.js OBJ file parser

## Supported File Formats

- **.obj** - Wavefront OBJ format (with MTL materials support)

## Browser Compatibility

- Chrome/Edge 60+
- Firefox 55+
- Safari 11+
- Mobile browsers (iOS Safari 11+, Chrome Android 60+)

## Performance Tips

- For large models (100k+ polygons), consider optimizing geometry
- Use lower resolution screenshots if needed
- Clear browser cache if experiencing loading issues

## Customization

### Changing the Default Color

Edit `src/components/ThreeViewer.vue` and modify the material color in the `loadOBJ` function:

```javascript
child.material = new THREE.MeshPhongMaterial({
  color: 0x6366f1,  // Change this hex value
  specular: 0x111111,
  shininess: 200,
});
```

### Adjusting Lighting

Modify the light setup in the `initThreeScene` function within `ThreeViewer.vue`.

### Changing UI Colors

Edit the color variables in `ThreeViewer.vue` scoped styles section.

## Troubleshooting

### Model doesn't load
- Ensure the OBJ file is valid
- Check browser console for error messages
- Verify the file format is correct

### Slow performance
- Reduce model polygon count
- Close other browser tabs
- Try a different browser

### GitHub Pages deployment issues
- Verify the `base` path in `vite.config.js` matches your repository name
- Clear browser cache
- Check GitHub Actions logs for build errors

## License

MIT

## Support

For issues or questions, please create an issue on the GitHub repository.

---

Built with ❤️ for designers and 3D enthusiasts

