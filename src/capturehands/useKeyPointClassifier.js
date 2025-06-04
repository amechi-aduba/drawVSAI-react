import { useEffect, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import _ from 'lodash';

const calcLandmarkList = (image, landmarks) => {
  const { width: imageWidth, height: imageHeight } = image;
  const landmarkPoint = [];

  // Convert normalized landmarks into pixel coordinates
  Object.values(landmarks).forEach((landmark) => {
    const landmarkX = Math.min(landmark.x * imageWidth, imageWidth - 1);
    const landmarkY = Math.min(landmark.y * imageHeight, imageHeight - 1);
    landmarkPoint.push([landmarkX, landmarkY]);
  });

  return landmarkPoint;
};

const preProcessLandmark = (landmarkList) => {
  // Deep clone
  let tempLandmarkList = _.cloneDeep(landmarkList);

  let baseX = 0;
  let baseY = 0;

  // Convert to relative coordinates (take first landmark as origin)
  tempLandmarkList.forEach((landmarkPoint, index) => {
    if (index === 0) {
      baseX = parseInt(landmarkPoint[0]);
      baseY = parseInt(landmarkPoint[1]);
    }
    tempLandmarkList[index][0] = tempLandmarkList[index][0] - baseX;
    tempLandmarkList[index][1] = tempLandmarkList[index][1] - baseY;
  });

  // Flatten into 1D array
  tempLandmarkList = _.flatten(tempLandmarkList);

  // Normalize so that all values are in [-1, 1]
  const maxValue = Math.max(...tempLandmarkList.map((v) => Math.abs(v)));
  tempLandmarkList = tempLandmarkList.map((v) => v / maxValue);

  return tempLandmarkList;
};

function useKeyPointClassifier() {
  const model = useRef(null);

  const keyPointClassifier = async (landmarkList) => {
    // Run inference and return the predicted index
    const outputTensor = model.current.execute(
      tf.tensor2d([landmarkList])
    );
    // squeeze() and argMax() to get class index
    const prediction = await outputTensor.squeeze().argMax().data();
    return prediction;
  };

  const processLandmark = async (handLandmarks, image) => {
    const landmarkList = calcLandmarkList(image, handLandmarks);
    const preProcessedLandmarkList = preProcessLandmark(landmarkList);
    const handSignId = await keyPointClassifier(preProcessedLandmarkList);
    return handSignId[0]; // return the single class index
  };

  useEffect(() => {
    (async function loadModel() {
      // Adjust the path to your TFJS model folder accordingly
      model.current = await tf.loadGraphModel('/tf-models/key-point-classifier/model.json');
    })();
  }, []);

  return { processLandmark };
}

export default useKeyPointClassifier;
