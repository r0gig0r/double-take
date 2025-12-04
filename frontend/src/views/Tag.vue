<template>
  <div class="tag-wrapper" :style="{ paddingTop: toolbarHeight + 'px' }">
    <!-- Stats Header -->
    <div class="stats-header p-d-flex p-jc-around p-ai-center p-p-3" v-if="stats">
      <div class="stat-item p-text-center">
        <div class="stat-value">{{ stats.unknown_faces }}</div>
        <div class="stat-label">Unknown Faces</div>
      </div>
      <div class="stat-item p-text-center">
        <div class="stat-value">{{ stats.trained_subjects }}</div>
        <div class="stat-label">Trained Subjects</div>
      </div>
      <div class="stat-item p-text-center">
        <div class="stat-value">{{ stats.tagged_today }}</div>
        <div class="stat-label">Tagged Today</div>
      </div>
    </div>

    <!-- Filters Bar -->
    <div class="filters-bar p-d-flex p-ai-center p-p-3 p-gap-2">
      <Dropdown
        v-model="filters.camera"
        :options="cameras"
        placeholder="All Cameras"
        :showClear="true"
        @change="applyFilters"
      />
      <Dropdown
        v-model="filters.sort"
        :options="sortOptions"
        placeholder="Sort By"
        @change="applyFilters"
      />
      <Button
        :label="bulkSelectMode ? 'Cancel Bulk' : 'Bulk Select'"
        :icon="bulkSelectMode ? 'pi pi-times' : 'pi pi-check-square'"
        @click="toggleBulkSelect"
        class="p-button-sm"
      />
      <Button
        v-if="bulkSelectMode && selectedFaces.length > 0"
        :label="`Tag Selected (${selectedFaces.length})`"
        icon="pi pi-tag"
        @click="openBulkTagModal"
        class="p-button-success p-button-sm"
      />
    </div>

    <!-- Loading Spinner -->
    <div class="loading-wrapper p-d-flex p-flex-column p-jc-center" v-if="loading">
      <i class="pi pi-spin pi-spinner p-as-center" style="font-size: 2.5rem"></i>
    </div>

    <!-- No Faces Message -->
    <div v-if="!loading && faces.length === 0" class="p-text-center p-mt-5">
      <p class="p-text-bold">No unknown faces found</p>
      <p class="p-text-secondary">All faces have been tagged!</p>
    </div>

    <!-- Face Gallery Grid -->
    <div class="face-gallery p-p-3" v-if="!loading && faces.length > 0">
      <div
        v-for="face in faces"
        :key="face.id"
        class="face-card"
        :class="{ selected: isSelected(face.id) }"
        @click="handleFaceClick(face)"
      >
        <div class="face-image-container">
          <img
            :src="getImageUrl(face.filename)"
            :alt="face.camera"
            class="face-thumbnail"
            @error="handleImageError"
          />
          <Checkbox
            v-if="bulkSelectMode"
            v-model="selectedFaces"
            :value="face.id"
            @click.stop
            class="face-checkbox"
          />
        </div>
        <div class="face-info p-p-2">
          <div class="camera-name">{{ face.camera }}</div>
          <div class="timestamp">{{ formatTime(face.timestamp) }}</div>
          <div class="confidence" v-if="face.confidence > 0">
            Confidence: {{ face.confidence }}%
          </div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="pagination.total > pagination.limit" class="p-d-flex p-jc-center p-mt-3 p-mb-3">
      <Paginator
        :rows="pagination.limit"
        :totalRecords="pagination.total"
        :first="pagination.offset"
        @page="onPageChange"
      ></Paginator>
    </div>

    <!-- Tagging Modal -->
    <Dialog
      v-model:visible="showTagModal"
      :header="bulkTagging ? `Tag ${selectedFaces.length} Faces` : 'Tag Face'"
      :modal="true"
      :closable="true"
      :style="{ width: '600px' }"
    >
      <div v-if="currentFace" class="tag-modal-content">
        <div class="p-mb-3" v-if="!bulkTagging">
          <img
            :src="getImageUrl(currentFace.filename)"
            :alt="currentFace.camera"
            class="modal-face-image"
          />
        </div>
        <div class="p-field p-mb-3">
          <label for="subject-name">Person's Name</label>
          <AutoComplete
            v-model="subjectName"
            :suggestions="filteredSubjects"
            @complete="searchSubjects"
            placeholder="Enter or select name"
            id="subject-name"
            :dropdown="true"
            class="p-inputtext-sm"
            style="width: 100%"
          />
        </div>
        <div v-if="trainingProgress" class="p-mb-3">
          <ProgressBar :value="trainingProgressPercent"></ProgressBar>
          <p class="p-text-center p-mt-2">{{ trainingProgress }}</p>
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" icon="pi pi-times" @click="closeTagModal" class="p-button-text" />
        <Button
          label="Train"
          icon="pi pi-check"
          @click="trainFace"
          :loading="isTraining"
          :disabled="!subjectName"
        />
      </template>
    </Dialog>

    <!-- Subject Sidebar -->
    <Sidebar v-model:visible="showSubjectSidebar" position="right" :style="{ width: '400px' }">
      <h3>Trained Subjects</h3>
      <div v-if="loadingSubjects" class="p-text-center">
        <i class="pi pi-spin pi-spinner"></i>
      </div>
      <div v-else>
        <div
          v-for="subject in subjects"
          :key="subject.name"
          class="subject-item p-p-2 p-mb-2"
          style="border: 1px solid var(--surface-border); border-radius: 4px"
        >
          <div class="p-d-flex p-jc-between p-ai-center">
            <div>
              <div class="subject-name">{{ subject.name }}</div>
              <div class="subject-info">{{ subject.image_count }} training images</div>
            </div>
          </div>
        </div>
      </div>
    </Sidebar>

    <!-- Floating Action Button for Subject Sidebar -->
    <Button
      icon="pi pi-users"
      class="p-button-rounded p-button-lg floating-action-button"
      @click="showSubjectSidebar = true"
      v-tooltip.left="'View Trained Subjects'"
    />
  </div>
</template>

<script>
import ApiService from '@/services/api.service';
import Constants from '@/util/constants.util';
import Dropdown from 'primevue/dropdown';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import AutoComplete from 'primevue/autocomplete';
import Checkbox from 'primevue/checkbox';
import Sidebar from 'primevue/sidebar';
import ProgressBar from 'primevue/progressbar';
import Paginator from 'primevue/paginator';

export default {
  components: {
    Dropdown,
    Button,
    Dialog,
    AutoComplete,
    Checkbox,
    Sidebar,
    ProgressBar,
    Paginator,
  },
  props: {
    toolbarHeight: Number,
  },
  data: () => ({
    faces: [],
    stats: null,
    cameras: [],
    subjects: [],
    loading: false,
    loadingSubjects: false,
    filters: {
      camera: null,
      sort: 'date_desc',
    },
    sortOptions: [
      { label: 'Newest First', value: 'date_desc' },
      { label: 'Oldest First', value: 'date_asc' },
      { label: 'Confidence', value: 'confidence_desc' },
    ],
    pagination: {
      total: 0,
      limit: 50,
      offset: 0,
    },
    bulkSelectMode: false,
    selectedFaces: [],
    showTagModal: false,
    showSubjectSidebar: false,
    currentFace: null,
    subjectName: '',
    filteredSubjects: [],
    isTraining: false,
    bulkTagging: false,
    trainingProgress: null,
    trainingProgressPercent: 0,
  }),
  async mounted() {
    await this.loadData();
  },
  methods: {
    async loadData() {
      this.loading = true;
      try {
        await Promise.all([
          this.fetchFaces(),
          this.fetchStats(),
          this.fetchCameras(),
          this.fetchSubjects(),
        ]);
      } catch (error) {
        this.emitter.emit('error', error);
      } finally {
        this.loading = false;
      }
    },
    async fetchFaces() {
      try {
        const params = {
          limit: this.pagination.limit,
          offset: this.pagination.offset,
          sort: this.filters.sort,
        };
        if (this.filters.camera) {
          params.camera = this.filters.camera;
        }

        const response = await ApiService.get('tag/unknown-faces', { params });
        this.faces = response.data.faces;
        this.pagination.total = response.data.total;
      } catch (error) {
        console.error('Error fetching faces:', error);
        this.emitter.emit('error', error);
      }
    },
    async fetchStats() {
      try {
        const response = await ApiService.get('tag/stats');
        this.stats = response.data;
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    },
    async fetchCameras() {
      try {
        const response = await ApiService.get('tag/cameras');
        this.cameras = response.data.cameras.map((camera) => ({
          label: camera,
          value: camera,
        }));
      } catch (error) {
        console.error('Error fetching cameras:', error);
      }
    },
    async fetchSubjects() {
      this.loadingSubjects = true;
      try {
        const response = await ApiService.get('tag/subjects');
        this.subjects = response.data.subjects;
      } catch (error) {
        console.error('Error fetching subjects:', error);
      } finally {
        this.loadingSubjects = false;
      }
    },
    applyFilters() {
      this.pagination.offset = 0;
      this.fetchFaces();
    },
    onPageChange(event) {
      this.pagination.offset = event.first;
      this.fetchFaces();
    },
    toggleBulkSelect() {
      this.bulkSelectMode = !this.bulkSelectMode;
      if (!this.bulkSelectMode) {
        this.selectedFaces = [];
      }
    },
    isSelected(faceId) {
      return this.selectedFaces.includes(faceId);
    },
    handleFaceClick(face) {
      if (this.bulkSelectMode) {
        // Toggle selection
        const index = this.selectedFaces.indexOf(face.id);
        if (index > -1) {
          this.selectedFaces.splice(index, 1);
        } else {
          this.selectedFaces.push(face.id);
        }
      } else {
        // Open tag modal
        this.openTagModal(face);
      }
    },
    openTagModal(face) {
      this.currentFace = face;
      this.subjectName = '';
      this.bulkTagging = false;
      this.showTagModal = true;
    },
    openBulkTagModal() {
      if (this.selectedFaces.length === 0) return;
      this.currentFace = this.faces.find((f) => f.id === this.selectedFaces[0]);
      this.subjectName = '';
      this.bulkTagging = true;
      this.showTagModal = true;
    },
    closeTagModal() {
      this.showTagModal = false;
      this.currentFace = null;
      this.subjectName = '';
      this.trainingProgress = null;
      this.trainingProgressPercent = 0;
    },
    searchSubjects(event) {
      const query = event.query.toLowerCase();
      this.filteredSubjects = this.subjects
        .map((s) => s.name)
        .filter((name) => name.toLowerCase().includes(query));
    },
    async trainFace() {
      if (!this.subjectName) return;

      this.isTraining = true;
      try {
        if (this.bulkTagging) {
          await this.trainMultipleFaces();
        } else {
          await this.trainSingleFace();
        }
      } catch (error) {
        this.emitter.emit('error', error);
      } finally {
        this.isTraining = false;
      }
    },
    async trainSingleFace() {
      try {
        // Train via backend (which proxies to CompreFace)
        const response = await ApiService.post('tag/train-face', {
          filename: this.currentFace.filename,
          subject: this.subjectName,
        });

        // Only show success if we get here (no exception thrown)
        this.emitter.emit('toast', {
          severity: 'success',
          summary: 'Success',
          detail: `Successfully trained ${this.subjectName}`,
          life: 3000,
        });

        // Remove from list and close modal
        this.faces = this.faces.filter((f) => f.id !== this.currentFace.id);
        this.pagination.total -= 1;
        this.closeTagModal();

        // Refresh stats and subjects
        await this.fetchStats();
        await this.fetchSubjects();
      } catch (error) {
        console.error('Training error:', error);

        // Extract error message from various possible locations
        let errorMessage = 'Failed to train face';
        if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        } else if (error.message) {
          errorMessage = error.message;
        }

        this.emitter.emit('toast', {
          severity: 'error',
          summary: 'Training Failed',
          detail: errorMessage,
          life: 5000,
        });

        // Don't close modal on error so user can try again
      }
    },
    async trainMultipleFaces() {
      const facesToTrain = this.faces.filter((f) => this.selectedFaces.includes(f.id));
      const total = facesToTrain.length;
      let successCount = 0;
      const trainedFaceIds = [];

      try {
        for (let i = 0; i < facesToTrain.length; i++) {
          const face = facesToTrain[i];
          this.trainingProgress = `Training ${i + 1} of ${total}...`;
          this.trainingProgressPercent = Math.round(((i + 1) / total) * 100);

          try {
            // Train via backend (which proxies to CompreFace)
            await ApiService.post('tag/train-face', {
              filename: face.filename,
              subject: this.subjectName,
            });
            successCount++;
            trainedFaceIds.push(face.id);
          } catch (error) {
            console.error(`Failed to train face ${face.filename}:`, error);
            const errorMsg = error.response?.data?.error || error.message;
            console.error(`Error details: ${errorMsg}`);
          }
        }

        // Show appropriate message based on results
        if (successCount === total) {
          this.emitter.emit('toast', {
            severity: 'success',
            summary: 'Success',
            detail: `Successfully trained all ${total} faces as ${this.subjectName}`,
            life: 3000,
          });
        } else if (successCount > 0) {
          this.emitter.emit('toast', {
            severity: 'warn',
            summary: 'Partial Success',
            detail: `Trained ${successCount} of ${total} faces. ${total - successCount} faces had no detectable face or were too low quality.`,
            life: 5000,
          });
        } else {
          this.emitter.emit('toast', {
            severity: 'error',
            summary: 'Training Failed',
            detail: `Failed to train any faces. Images may not contain detectable faces.`,
            life: 5000,
          });
        }

        // Remove successfully trained faces from list
        if (trainedFaceIds.length > 0) {
          this.faces = this.faces.filter((f) => !trainedFaceIds.includes(f.id));
          this.pagination.total -= trainedFaceIds.length;
        }

        this.selectedFaces = [];
        this.bulkSelectMode = false;
        this.closeTagModal();

        // Refresh stats and subjects if any succeeded
        if (successCount > 0) {
          await this.fetchStats();
          await this.fetchSubjects();
        }
      } catch (error) {
        console.error('Bulk training error:', error);
        this.emitter.emit('toast', {
          severity: 'error',
          summary: 'Error',
          detail: 'An unexpected error occurred during bulk training',
          life: 5000,
        });
      }
    },
    getImageUrl(filename) {
      const constants = Constants();
      return `${constants.api}/storage/matches/${filename}`;
    },
    handleImageError(event) {
      event.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"%3E%3C/svg%3E';
    },
    formatTime(timestamp) {
      return new Date(timestamp).toLocaleString();
    },
  },
};
</script>

<style scoped>
.tag-wrapper {
  min-height: 100vh;
  background: var(--surface-ground);
}

.stats-header {
  background: var(--surface-card);
  border-bottom: 1px solid var(--surface-border);
}

.stat-item {
  flex: 1;
}

.stat-value {
  font-size: 2rem;
  font-weight: bold;
  color: var(--primary-color);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.filters-bar {
  background: var(--surface-card);
  border-bottom: 1px solid var(--surface-border);
}

.face-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
}

.face-card {
  background: var(--surface-card);
  border: 2px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
}

.face-card:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.face-card.selected {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px var(--primary-color);
}

.face-image-container {
  position: relative;
  width: 100%;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-ground);
  overflow: hidden;
}

.face-thumbnail {
  width: 100%;
  height: auto;
  max-height: 300px;
  object-fit: contain;
}

.face-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
}

.face-info {
  background: var(--surface-card);
}

.camera-name {
  font-weight: 600;
  margin-bottom: 4px;
}

.timestamp,
.confidence {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.modal-face-image {
  width: 100%;
  height: auto;
  max-height: 500px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--surface-ground);
}

.floating-action-button {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  z-index: 1000;
}

.subject-item {
  cursor: pointer;
  transition: background 0.2s;
}

.subject-item:hover {
  background: var(--surface-hover);
}

.subject-name {
  font-weight: 600;
  margin-bottom: 4px;
}

.subject-info {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.loading-wrapper {
  padding: 4rem 0;
}
</style>
